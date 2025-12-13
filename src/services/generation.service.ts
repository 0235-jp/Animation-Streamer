import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  ResolvedAction,
  ResolvedPreset,
  ResolvedConfig,
  type VoicevoxVoiceProfile,
  type Sbv2VoiceProfile,
  type ResolvedVoicevoxAudioProfile,
  type ResolvedSbv2AudioProfile,
} from '../config/loader'
import { ClipPlanner } from './clip-planner'
import { MediaPipeline, type ClipSource, NoAudioTrackError } from './media-pipeline'
import { VoicevoxClient, type VoicevoxVoiceOptions } from './voicevox'
import { StyleBertVits2Client, type StyleBertVits2VoiceOptions } from './style-bert-vits2'
import { STTClient } from './stt'
import { CacheService, type SpeakCacheKeyData, type IdleCacheKeyData, type CombinedCacheKeyData, type SpeakInputType } from './cache.service'
import type { ActionResult, GenerateRequestItem, GenerateRequestPayload, StreamPushHandler, AudioInput } from '../types/generate'
import { logger } from '../utils/logger'

const DEFAULT_EMOTION = 'neutral'

class ActionProcessingError extends Error {
  constructor(
    message: string,
    public readonly requestId: string,
    public readonly statusCode: number = 400
  ) {
    super(message)
    this.name = 'ActionProcessingError'
  }
}

interface PlannedAction {
  id: string
  action: string
  clips: ClipSource[]
  motionIds: string[]
  durationMs: number
  audioPath: string
  cacheHash?: string
  text?: string
  inputType?: SpeakInputType
}

interface IndexedRequest {
  requestId: string
  item: GenerateRequestItem
}

interface CombinedResult {
  outputPath: string
  durationMs: number
  motionIds?: string[]
}

type BaseActionPlan = Omit<PlannedAction, 'audioPath'>
type IdlePlanData = BaseActionPlan & { requestedDurationMs: number }

type StreamBatchResult = { kind: 'stream'; results: ActionResult[] }
type CombinedBatchResult = { kind: 'combined'; result: CombinedResult }

export class GenerationService {
  private readonly config: ResolvedConfig
  private readonly clipPlanner: ClipPlanner
  private readonly mediaPipeline: MediaPipeline
  private readonly voicevox: VoicevoxClient
  private readonly sbv2: StyleBertVits2Client
  private readonly cacheService: CacheService

  constructor(deps: {
    config: ResolvedConfig
    clipPlanner: ClipPlanner
    mediaPipeline: MediaPipeline
    voicevox: VoicevoxClient
    sbv2: StyleBertVits2Client
    cacheService: CacheService
  }) {
    this.config = deps.config
    this.clipPlanner = deps.clipPlanner
    this.mediaPipeline = deps.mediaPipeline
    this.voicevox = deps.voicevox
    this.sbv2 = deps.sbv2
    this.cacheService = deps.cacheService
  }

  async processBatch(
    payload: GenerateRequestPayload,
    handler?: StreamPushHandler
  ): Promise<StreamBatchResult | CombinedBatchResult> {
    const preset = this.resolvePresetById(this.ensureString(payload.presetId, 'presetId', '0'))
    const includeDebug = Boolean(payload.debug)
    const useCache = Boolean(payload.cache)
    const indexedRequests: IndexedRequest[] = payload.requests.map((item, index) => ({
      item,
      requestId: String(index + 1),
    }))

    const forStreamPipeline = payload.forStreamPipeline ?? false
    if (payload.stream) {
      const results = await this.processStreamingBatch(indexedRequests, preset, includeDebug, forStreamPipeline, useCache, handler)
      return { kind: 'stream', results }
    }
    const combined = await this.processCombinedBatch(indexedRequests, preset, includeDebug, useCache)
    return { kind: 'combined', result: combined }
  }

  private async processStreamingBatch(
    indexedRequests: IndexedRequest[],
    preset: ResolvedPreset,
    includeDebug: boolean,
    forStreamPipeline: boolean,
    useCache: boolean,
    handler?: StreamPushHandler
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = []
    for (const { item, requestId } of indexedRequests) {
      try {
        const result = await this.processSingle(preset, item, requestId, includeDebug, forStreamPipeline, useCache)
        if (handler?.onResult) {
          await handler.onResult(result)
        }
        results.push(result)
      } catch (error) {
        if (error instanceof ActionProcessingError) {
          throw error
        }
        throw new ActionProcessingError(
          error instanceof Error ? error.message : '不明なエラーが発生しました',
          requestId,
          500
        )
      }
    }
    return results
  }

  private async processCombinedBatch(
    indexedRequests: IndexedRequest[],
    preset: ResolvedPreset,
    includeDebug: boolean,
    useCache: boolean
  ): Promise<CombinedResult> {
    const plannedActions: PlannedAction[] = []
    const actionHashes: string[] = []
    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      for (const { item, requestId } of indexedRequests) {
        try {
          const planned = await this.planAction(preset, item, jobDir, requestId)
          plannedActions.push(planned)
          if (planned.cacheHash) {
            actionHashes.push(planned.cacheHash)
          }
        } catch (error) {
          if (error instanceof ActionProcessingError) throw error
          throw new ActionProcessingError(
            error instanceof Error ? error.message : '不明なエラーが発生しました',
            requestId,
            500
          )
        }
      }

      // 結合動画のキャッシュキーを生成
      const combinedCacheKey: CombinedCacheKeyData = {
        type: 'combined',
        presetId: preset.id,
        actionHashes,
      }
      const combinedHash = this.cacheService.generateCacheKey(combinedCacheKey)

      // キャッシュチェック
      if (useCache) {
        const cachedPath = await this.cacheService.checkCache(combinedHash)
        if (cachedPath) {
          const durationMs = await this.mediaPipeline.getVideoDurationMs(cachedPath)
          return {
            outputPath: this.toResponsePath(cachedPath),
            durationMs: Math.round(durationMs),
            motionIds: includeDebug ? plannedActions.flatMap((action) => action.motionIds) : undefined,
          }
        }
      }

      const totalDuration = plannedActions.reduce((sum, action) => sum + action.durationMs, 0)
      const audioPaths = plannedActions.map((action) => action.audioPath)
      const { outputPath: combinedAudioPath } = await this.mediaPipeline.concatAudioFiles(audioPaths, jobDir)

      const timelineClips = plannedActions.flatMap((action) => action.clips)
      const { outputPath: combinedTempPath } = await this.mediaPipeline.compose({
        clips: timelineClips,
        audioPath: combinedAudioPath,
        durationMs: totalDuration,
        jobDir,
      })

      // ファイル名を決定（キャッシュ有効: ハッシュのみ、無効: ハッシュ+UUID）
      const baseName = useCache ? combinedHash : `${combinedHash}-${randomUUID()}`
      const outputPath = await this.moveToOutput(combinedTempPath, baseName, false)

      // ログに追記
      const fileName = `${baseName}.mp4`
      const logActions = plannedActions.map((action) => ({
        type: action.action,
        text: action.text,
        durationMs: action.action === 'idle' ? action.durationMs : undefined,
        inputType: action.inputType,
      }))
      const logEntry = this.cacheService.createCombinedLogEntry(fileName, preset.id, logActions)
      await this.cacheService.appendLog(logEntry)

      return {
        outputPath,
        durationMs: Math.round(totalDuration),
        motionIds: includeDebug ? plannedActions.flatMap((action) => action.motionIds) : undefined,
      }
    } finally {
      await this.mediaPipeline.removeJobDir(jobDir)
    }
  }

  private async processSingle(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    requestId: string,
    includeDebug: boolean,
    forStream = false,
    useCache = false
  ): Promise<ActionResult> {
    const actionName = item.action.toLowerCase()
    switch (actionName) {
      case 'speak':
        return this.handleSpeak(preset, item, requestId, includeDebug, forStream, useCache)
      case 'idle':
        return this.handleIdle(preset, item, requestId, includeDebug, forStream, useCache)
      default:
        return this.handleCustomAction(preset, item, requestId, includeDebug, forStream)
    }
  }

  private async planAction(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    const actionName = item.action.toLowerCase()
    switch (actionName) {
      case 'speak':
        return this.planSpeakAction(preset, item, jobDir, requestId)
      case 'idle':
        return this.planIdleAction(preset, item, jobDir, requestId)
      default:
        return this.planCustomAction(preset, item, jobDir, requestId)
    }
  }

  private async handleSpeak(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    requestId: string,
    includeDebug: boolean,
    forStream = false,
    useCache = false
  ): Promise<ActionResult> {
    const params = item.params ?? {}
    const emotion = this.ensureOptionalString(params.emotion) ?? DEFAULT_EMOTION

    // キャッシュキーを生成
    const cacheKeyData = await this.buildSpeakCacheKeyData(preset, params, emotion)
    const cacheHash = this.cacheService.generateCacheKey(cacheKeyData)

    // forStream でない場合のみキャッシュをチェック
    if (!forStream && useCache) {
      const cachedPath = await this.cacheService.checkCache(cacheHash)
      if (cachedPath) {
        const durationMs = await this.mediaPipeline.getVideoDurationMs(cachedPath)
        return {
          id: requestId,
          action: item.action,
          outputPath: this.toResponsePath(cachedPath),
          durationMs: Math.round(durationMs),
        }
      }
    }

    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      const plan = await this.buildSpeakPlan(preset, item, jobDir, requestId)
      const { outputPath, durationMs } = await this.mediaPipeline.compose({
        clips: plan.clips,
        audioPath: plan.audioPath,
        durationMs: plan.durationMs,
        jobDir,
      })

      // ファイル名を決定（ストリーム: UUID、通常: ハッシュベース）
      const baseName = forStream
        ? `speak-${requestId}-${randomUUID()}`
        : useCache ? cacheHash : `${cacheHash}-${randomUUID()}`
      const finalPath = await this.moveToOutput(outputPath, baseName, forStream)

      // 非ストリームモードではログに追記
      if (!forStream) {
        const fileName = `${baseName}.mp4`
        const logEntry = this.cacheService.createSpeakLogEntry(
          fileName,
          preset.id,
          cacheKeyData.inputType,
          {
            text: cacheKeyData.text ?? plan.text,
            audioHash: cacheKeyData.audioHash,
            ttsEngine: cacheKeyData.ttsEngine,
            speakerId: cacheKeyData.ttsSettings?.speakerId as number | undefined,
            emotion,
          }
        )
        await this.cacheService.appendLog(logEntry)
      }

      const result: ActionResult = {
        id: requestId,
        action: item.action,
        outputPath: finalPath,
        durationMs: Math.round(durationMs),
      }
      if (includeDebug) {
        result.motionIds = plan.motionIds
      }
      return result
    } finally {
      await this.mediaPipeline.removeJobDir(jobDir)
    }
  }

  private async handleIdle(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    requestId: string,
    includeDebug: boolean,
    forStream = false,
    useCache = false
  ): Promise<ActionResult> {
    const params = item.params ?? {}
    const durationMs = this.ensurePositiveNumber(params.durationMs, 'durationMs', requestId)
    const motionId = this.ensureOptionalString(params.motionId)
    const emotion = this.ensureOptionalString(params.emotion) ?? DEFAULT_EMOTION

    // キャッシュキーを生成
    const cacheKeyData: IdleCacheKeyData = {
      type: 'idle',
      presetId: preset.id,
      durationMs,
      emotion,
    }
    if (motionId) {
      cacheKeyData.motionId = motionId
    }
    const cacheHash = this.cacheService.generateCacheKey(cacheKeyData)

    // forStream でない場合のみキャッシュをチェック
    if (!forStream && useCache) {
      const cachedPath = await this.cacheService.checkCache(cacheHash)
      if (cachedPath) {
        const cachedDurationMs = await this.mediaPipeline.getVideoDurationMs(cachedPath)
        return {
          id: requestId,
          action: item.action,
          outputPath: this.toResponsePath(cachedPath),
          durationMs: Math.round(cachedDurationMs),
        }
      }
    }

    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      const plan = await this.buildIdlePlanData(preset, item, requestId)
      const { outputPath, durationMs: actualDuration } = await this.mediaPipeline.compose({
        clips: plan.clips,
        durationMs: plan.requestedDurationMs,
        jobDir,
      })

      // ファイル名を決定（ストリーム: UUID、通常: ハッシュベース）
      const baseName = forStream
        ? `idle-${requestId}-${randomUUID()}`
        : useCache ? cacheHash : `${cacheHash}-${randomUUID()}`
      const finalPath = await this.moveToOutput(outputPath, baseName, forStream)

      // 非ストリームモードではログに追記
      if (!forStream) {
        const fileName = `${baseName}.mp4`
        const logEntry = this.cacheService.createIdleLogEntry(
          fileName,
          preset.id,
          durationMs,
          emotion,
          motionId
        )
        await this.cacheService.appendLog(logEntry)
      }

      const result: ActionResult = {
        id: requestId,
        action: item.action,
        outputPath: finalPath,
        durationMs: Math.round(actualDuration),
      }
      if (includeDebug) {
        result.motionIds = plan.motionIds
      }
      return result
    } finally {
      await this.mediaPipeline.removeJobDir(jobDir)
    }
  }

  private async handleCustomAction(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    requestId: string,
    includeDebug: boolean,
    forStream = false
  ): Promise<ActionResult> {
    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      const plan = await this.planCustomAction(preset, item, jobDir, requestId)
      const { outputPath, durationMs } = await this.mediaPipeline.compose({
        clips: plan.clips,
        audioPath: plan.audioPath,
        durationMs: plan.durationMs,
        jobDir,
      })
      const actionId = item.action.toLowerCase()
      const finalPath = await this.moveToOutput(outputPath, `${preset.id}-${actionId}`, forStream)
      const result: ActionResult = {
        id: requestId,
        action: item.action,
        outputPath: finalPath,
        durationMs: Math.round(durationMs),
      }
      if (includeDebug) {
        result.motionIds = plan.motionIds
      }
      return result
    } finally {
      await this.mediaPipeline.removeJobDir(jobDir)
    }
  }

  private ensureString(value: unknown, field: string, requestId: string): string {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    throw new ActionProcessingError(`${field} は必須です`, requestId)
  }

  private ensureOptionalString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
    return undefined
  }

  private ensurePositiveNumber(value: unknown, field: string, requestId: string): number {
    const num = typeof value === 'string' ? Number(value) : value
    if (typeof num === 'number' && Number.isFinite(num) && num > 0) {
      return Math.round(num)
    }
    throw new ActionProcessingError(`${field} は正の数値で指定してください`, requestId)
  }

  private async moveToOutput(sourcePath: string, baseName: string, forStream = false): Promise<string> {
    const fileName = `${baseName}.mp4`
    // ストリームモードではoutput/streamに出力（FFmpegのworkDirと同じ場所）
    const outputDir = forStream
      ? path.join(this.config.paths.outputDir, 'stream')
      : this.config.paths.outputDir
    await fs.mkdir(outputDir, { recursive: true })
    const destination = path.join(outputDir, fileName)
    try {
      await fs.rename(sourcePath, destination)
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === 'EXDEV') {
        await fs.copyFile(sourcePath, destination)
        await fs.rm(sourcePath, { force: true })
      } else {
        throw error
      }
    }
    // ストリームモードでは実際のファイルパスを返す（FFmpegが参照するため）
    // APIレスポンス用には変換されたパスを返す
    const responsePath = forStream ? destination : this.toResponsePath(destination)
    logger.info({ destination, responsePath }, 'Generated clip')
    return responsePath
  }

  private async planSpeakAction(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    const params = item.params ?? {}
    const emotion = this.ensureOptionalString(params.emotion) ?? DEFAULT_EMOTION

    // キャッシュキーを生成
    const cacheKeyData = await this.buildSpeakCacheKeyData(preset, params, emotion)
    const cacheHash = this.cacheService.generateCacheKey(cacheKeyData)

    const plan = await this.buildSpeakPlan(preset, item, jobDir, requestId)
    return {
      ...plan,
      cacheHash,
      text: cacheKeyData.text,
      inputType: cacheKeyData.inputType,
    }
  }

  private async buildSpeakPlan(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    const params = item.params ?? {}
    const emotion = this.ensureOptionalString(params.emotion) ?? DEFAULT_EMOTION
    const audio = params.audio as AudioInput | undefined

    // 音声ソースの取得（text, audio.path, audio.base64 のいずれか）
    let rawAudioPath: string
    if (audio) {
      rawAudioPath = await this.resolveAudioInput(audio, preset, jobDir, requestId, emotion)
    } else {
      // 既存: テキスト → TTS
      const text = this.ensureString(params.text, 'text', requestId)
      rawAudioPath = await this.synthesizeFromText(text, preset, jobDir, requestId, emotion)
    }

    // 以降は共通処理: 正規化 → トリム → モーション計画
    const normalizedAudio = await this.mediaPipeline.normalizeAudio(rawAudioPath, jobDir, `voice-${requestId}`)
    const trimmedAudio = await this.mediaPipeline.trimAudioSilence(normalizedAudio, jobDir, `voice-${requestId}-trim`)
    const trimmedDuration = await this.mediaPipeline.getAudioDurationMs(trimmedAudio)
    const useTrimmedAudio = trimmedDuration > 0
    if (!useTrimmedAudio) {
      logger.warn({ requestId }, 'Trimmed audio is empty, falling back to normalized audio')
    }
    const effectiveAudioPath = useTrimmedAudio ? trimmedAudio : normalizedAudio
    const audioDuration = useTrimmedAudio
      ? trimmedDuration
      : await this.mediaPipeline.getAudioDurationMs(normalizedAudio)
    const plan = await this.clipPlanner.buildSpeechPlan(preset.id, emotion, audioDuration)
    const durationMs = plan.totalDurationMs
    const talkDuration = plan.talkDurationMs ?? durationMs
    const fittedAudio = await this.mediaPipeline.fitAudioDuration(
      effectiveAudioPath,
      talkDuration,
      jobDir,
      `voice-${requestId}-fit`
    )

    const audioSegments: string[] = []
    if (plan.enterDurationMs && plan.enterDurationMs > 0) {
      const pre = await this.mediaPipeline.createSilentAudio(plan.enterDurationMs, jobDir)
      audioSegments.push(pre)
    }
    audioSegments.push(fittedAudio)
    if (plan.exitDurationMs && plan.exitDurationMs > 0) {
      const post = await this.mediaPipeline.createSilentAudio(plan.exitDurationMs, jobDir)
      audioSegments.push(post)
    }

    let finalAudioPath = fittedAudio
    if (audioSegments.length > 1) {
      const { outputPath } = await this.mediaPipeline.concatAudioFiles(audioSegments, jobDir)
      finalAudioPath = outputPath
    }

    return {
      id: requestId,
      action: item.action,
      clips: plan.clips,
      motionIds: plan.motionIds,
      durationMs,
      audioPath: finalAudioPath,
    }
  }

  /**
   * 音声入力を解決する（直接使用 or STT→TTS）
   */
  private async resolveAudioInput(
    audio: AudioInput,
    preset: ResolvedPreset,
    jobDir: string,
    requestId: string,
    emotion: string
  ): Promise<string> {
    // 音声ファイルパスを取得
    let audioFilePath: string
    if (audio.base64) {
      // Base64 → ファイルに保存
      audioFilePath = await this.saveBase64Audio(audio.base64, jobDir, requestId)
    } else if (audio.path) {
      // 外部ファイルをコピー
      audioFilePath = await this.copyExternalAudio(audio.path, jobDir, requestId)
    } else {
      throw new ActionProcessingError('audio には path または base64 のいずれかを指定してください', requestId)
    }

    // transcribe=true の場合は STT → TTS
    if (audio.transcribe) {
      const text = await this.transcribeAudio(audioFilePath, requestId)
      logger.info({ requestId, textLength: text.length }, 'Audio transcribed, synthesizing with TTS')
      return this.synthesizeFromText(text, preset, jobDir, requestId, emotion)
    }

    // 直接使用
    return audioFilePath
  }

  /**
   * テキストから音声を合成する
   */
  private async synthesizeFromText(
    text: string,
    preset: ResolvedPreset,
    jobDir: string,
    requestId: string,
    emotion: string
  ): Promise<string> {
    const audioPath = path.join(jobDir, `voice-${requestId}.wav`)
    const audioProfile = preset.audioProfile

    if (audioProfile.ttsEngine === 'voicevox') {
      const { voice, endpoint } = this.resolveVoicevoxVoiceProfile(audioProfile, emotion)
      await this.voicevox.synthesize(text, audioPath, voice, { endpoint })
    } else {
      const { voice, endpoint } = this.resolveSbv2VoiceProfile(audioProfile, emotion)
      await this.sbv2.synthesize(text, audioPath, voice, { endpoint })
    }
    return audioPath
  }

  /**
   * Base64エンコード音声をファイルに保存
   */
  private async saveBase64Audio(base64Data: string, jobDir: string, requestId: string): Promise<string> {
    const audioPath = path.join(jobDir, `audio-input-${requestId}.wav`)
    const buffer = Buffer.from(base64Data, 'base64')
    await fs.writeFile(audioPath, buffer)
    logger.info({ requestId, size: buffer.length }, 'Saved base64 audio to file')
    return audioPath
  }

  /**
   * 外部音声ファイルをジョブディレクトリにコピー
   */
  private async copyExternalAudio(externalPath: string, jobDir: string, requestId: string): Promise<string> {
    try {
      await fs.access(externalPath)
    } catch {
      throw new ActionProcessingError(
        `指定された音声ファイルが見つかりません: ${externalPath}`,
        requestId
      )
    }
    const ext = path.extname(externalPath) || '.wav'
    const audioPath = path.join(jobDir, `audio-input-${requestId}${ext}`)
    await fs.copyFile(externalPath, audioPath)
    logger.info({ requestId, source: externalPath }, 'Copied external audio file')
    return audioPath
  }

  /**
   * 音声をテキストに変換（STT）
   */
  private async transcribeAudio(audioPath: string, requestId: string): Promise<string> {
    const sttConfig = this.config.stt
    if (!sttConfig) {
      throw new ActionProcessingError(
        'STT を使用するには設定ファイルの stt セクションを設定してください',
        requestId
      )
    }

    const sttClient = new STTClient({
      baseUrl: sttConfig.baseUrl,
      apiKey: sttConfig.apiKey,
      model: sttConfig.model,
      language: sttConfig.language,
    })
    const text = await sttClient.transcribe(audioPath)

    if (!text.trim()) {
      throw new ActionProcessingError('音声からテキストを認識できませんでした', requestId)
    }

    return text
  }

  private async planIdleAction(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    const params = item.params ?? {}
    const durationMs = this.ensurePositiveNumber(params.durationMs, 'durationMs', requestId)
    const motionId = this.ensureOptionalString(params.motionId)
    const emotion = this.ensureOptionalString(params.emotion) ?? DEFAULT_EMOTION

    // キャッシュキーを生成
    const cacheKeyData: IdleCacheKeyData = {
      type: 'idle',
      presetId: preset.id,
      durationMs,
      emotion,
    }
    if (motionId) {
      cacheKeyData.motionId = motionId
    }
    const cacheHash = this.cacheService.generateCacheKey(cacheKeyData)

    const plan = await this.buildIdlePlanData(preset, item, requestId)
    const audioPath = await this.mediaPipeline.createSilentAudio(plan.durationMs, jobDir)
    return {
      id: plan.id,
      action: plan.action,
      clips: plan.clips,
      motionIds: plan.motionIds,
      durationMs: plan.durationMs,
      audioPath,
      cacheHash,
    }
  }

  private async planCustomAction(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    const [plan, actionConfig] = await this.buildCustomActionPlanData(preset, item, requestId)
    let extractedAudio: string
    try {
      extractedAudio = await this.mediaPipeline.extractAudioTrack(
        actionConfig.absolutePath,
        jobDir,
        actionConfig.id
      )
    } catch (error) {
      if (error instanceof NoAudioTrackError) {
        const audioPath = await this.mediaPipeline.createSilentAudio(plan.durationMs, jobDir)
        return {
          ...plan,
          audioPath,
        }
      }
      throw error
    }

    const audioPath = await this.mediaPipeline.fitAudioDuration(
      extractedAudio,
      plan.durationMs,
      jobDir,
      `${actionConfig.id}-fit`
    )
    return {
      ...plan,
      audioPath,
    }
  }

  private resolveVoicevoxVoiceProfile(
    audioProfile: ResolvedVoicevoxAudioProfile,
    emotion: string | undefined
  ): { voice: VoicevoxVoiceOptions; endpoint: string } {
    const normalizedEmotion = (emotion ?? 'neutral').trim().toLowerCase()
    let matchingVoice: VoicevoxVoiceProfile | undefined
    let neutralVoice: VoicevoxVoiceProfile | undefined

    for (const voice of audioProfile.voices) {
      if (voice.emotion === normalizedEmotion) {
        matchingVoice = voice
        break
      }
      if (!neutralVoice && voice.emotion === 'neutral') {
        neutralVoice = voice
      }
    }

    const selected = matchingVoice ?? neutralVoice
    if (!selected) {
      throw new Error('voicesに少なくとも1つの音声設定が必要です')
    }
    return { voice: selected, endpoint: audioProfile.voicevoxUrl }
  }

  private resolveSbv2VoiceProfile(
    audioProfile: ResolvedSbv2AudioProfile,
    emotion: string | undefined
  ): { voice: StyleBertVits2VoiceOptions; endpoint: string } {
    const normalizedEmotion = (emotion ?? 'neutral').trim().toLowerCase()
    let matchingVoice: Sbv2VoiceProfile | undefined
    let neutralVoice: Sbv2VoiceProfile | undefined

    for (const voice of audioProfile.voices) {
      if (voice.emotion === normalizedEmotion) {
        matchingVoice = voice
        break
      }
      if (!neutralVoice && voice.emotion === 'neutral') {
        neutralVoice = voice
      }
    }

    const selected = matchingVoice ?? neutralVoice
    if (!selected) {
      throw new Error('voicesに少なくとも1つの音声設定が必要です')
    }
    return { voice: selected, endpoint: audioProfile.sbv2Url }
  }

  private async buildIdlePlanData(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    requestId: string
  ): Promise<IdlePlanData> {
    const params = item.params ?? {}
    const durationMs = this.ensurePositiveNumber(params.durationMs, 'durationMs', requestId)
    const motionId = this.ensureOptionalString(params.motionId)
    const emotion = this.ensureOptionalString(params.emotion)
    const plan = await this.clipPlanner.buildIdlePlan(preset.id, durationMs, motionId, emotion)
    return {
      id: requestId,
      action: item.action,
      clips: plan.clips,
      motionIds: plan.motionIds,
      durationMs: plan.totalDurationMs,
      requestedDurationMs: durationMs,
    }
  }

  private async buildCustomActionPlanData(
    preset: ResolvedPreset,
    item: GenerateRequestItem,
    requestId: string
  ): Promise<[BaseActionPlan, ResolvedAction]> {
    const actionName = item.action.toLowerCase()
    if (actionName === 'speak' || actionName === 'idle') {
      throw new ActionProcessingError('予約語はactionsに登録できません', requestId)
    }
    const action = preset.actionsMap.get(actionName)
    if (!action) {
      throw new ActionProcessingError(`presetId=${preset.id} にアクション ${item.action} は定義されていません`, requestId)
    }
    const plan = await this.clipPlanner.buildActionClip(action)
    const basePlan: BaseActionPlan = {
      id: requestId,
      action: item.action,
      clips: plan.clips,
      motionIds: plan.motionIds,
      durationMs: plan.totalDurationMs,
    }
    return [basePlan, action]
  }

  private resolvePresetById(presetId: string): ResolvedPreset {
    const normalizedId = presetId.trim()
    const preset = this.config.presetMap.get(normalizedId)
    if (!preset) {
      throw new ActionProcessingError(`presetId=${normalizedId} は未定義です`, '0', 400)
    }
    return preset
  }

  private toResponsePath(absolutePath: string): string {
    const { responsePathBase, outputDir } = this.config.paths
    if (!responsePathBase) {
      return absolutePath
    }
    const relative = path.relative(outputDir, absolutePath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      return absolutePath
    }
    return path.join(responsePathBase, relative)
  }

  private async buildSpeakCacheKeyData(
    preset: ResolvedPreset,
    params: Record<string, unknown>,
    emotion: string
  ): Promise<SpeakCacheKeyData> {
    const audio = params.audio as AudioInput | undefined
    const audioProfile = preset.audioProfile

    if (audio) {
      // 音声入力の場合
      let audioHash: string
      if (audio.base64) {
        const buffer = Buffer.from(audio.base64, 'base64')
        audioHash = await this.cacheService.computeBufferHash(buffer)
      } else if (audio.path) {
        audioHash = await this.cacheService.computeFileHash(audio.path)
      } else {
        throw new Error('audio には path または base64 のいずれかを指定してください')
      }

      if (audio.transcribe) {
        // STT → TTS の場合
        const ttsSettings = this.getTtsSettings(audioProfile, emotion)
        return {
          type: 'speak',
          presetId: preset.id,
          inputType: 'audio_transcribe',
          audioHash,
          ttsEngine: audioProfile.ttsEngine,
          ttsSettings,
          emotion,
        }
      } else {
        // 音声直接使用の場合
        return {
          type: 'speak',
          presetId: preset.id,
          inputType: 'audio',
          audioHash,
          emotion,
        }
      }
    } else {
      // テキスト入力の場合
      const text = params.text as string
      const ttsSettings = this.getTtsSettings(audioProfile, emotion)
      return {
        type: 'speak',
        presetId: preset.id,
        inputType: 'text',
        text,
        ttsEngine: audioProfile.ttsEngine,
        ttsSettings,
        emotion,
      }
    }
  }

  private getTtsSettings(
    audioProfile: ResolvedVoicevoxAudioProfile | ResolvedSbv2AudioProfile,
    emotion: string
  ): Record<string, unknown> {
    if (audioProfile.ttsEngine === 'voicevox') {
      const { voice } = this.resolveVoicevoxVoiceProfile(audioProfile, emotion)
      // emotion はキャッシュキーに別途含まれるため除外
      const { emotion: _emotion, ...ttsSettings } = voice
      return ttsSettings
    } else {
      const { voice } = this.resolveSbv2VoiceProfile(audioProfile, emotion)
      // emotion はキャッシュキーに別途含まれるため除外
      const { emotion: _emotion, ...ttsSettings } = voice
      return ttsSettings
    }
  }
}

export { ActionProcessingError }
