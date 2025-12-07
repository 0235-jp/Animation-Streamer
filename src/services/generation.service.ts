import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ResolvedAction, ResolvedPreset, ResolvedConfig, type VoicevoxVoiceProfile } from '../config/loader'
import { ClipPlanner } from './clip-planner'
import { MediaPipeline, type ClipSource, NoAudioTrackError } from './media-pipeline'
import { VoicevoxClient, type VoicevoxVoiceOptions } from './voicevox'
import { STTClient } from './stt'
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

  constructor(deps: {
    config: ResolvedConfig
    clipPlanner: ClipPlanner
    mediaPipeline: MediaPipeline
    voicevox: VoicevoxClient
  }) {
    this.config = deps.config
    this.clipPlanner = deps.clipPlanner
    this.mediaPipeline = deps.mediaPipeline
    this.voicevox = deps.voicevox
  }

  async processBatch(
    payload: GenerateRequestPayload,
    handler?: StreamPushHandler
  ): Promise<StreamBatchResult | CombinedBatchResult> {
    const preset = this.resolvePresetById(this.ensureString(payload.presetId, 'presetId', '0'))
    const includeDebug = Boolean(payload.debug)
    const indexedRequests: IndexedRequest[] = payload.requests.map((item, index) => ({
      item,
      requestId: String(index + 1),
    }))

    const forStreamPipeline = payload.forStreamPipeline ?? false
    if (payload.stream) {
      const results = await this.processStreamingBatch(indexedRequests, preset, includeDebug, forStreamPipeline, handler)
      return { kind: 'stream', results }
    }
    const combined = await this.processCombinedBatch(indexedRequests, preset, includeDebug)
    return { kind: 'combined', result: combined }
  }

  private async processStreamingBatch(
    indexedRequests: IndexedRequest[],
    preset: ResolvedPreset,
    includeDebug: boolean,
    forStreamPipeline: boolean,
    handler?: StreamPushHandler
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = []
    for (const { item, requestId } of indexedRequests) {
      try {
        const result = await this.processSingle(preset, item, requestId, includeDebug, forStreamPipeline)
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
    includeDebug: boolean
  ): Promise<CombinedResult> {
    const plannedActions: PlannedAction[] = []
    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      for (const { item, requestId } of indexedRequests) {
        try {
          const planned = await this.planAction(preset, item, jobDir, requestId)
          plannedActions.push(planned)
        } catch (error) {
          if (error instanceof ActionProcessingError) throw error
          throw new ActionProcessingError(
            error instanceof Error ? error.message : '不明なエラーが発生しました',
            requestId,
            500
          )
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
      const combinedPath = await this.moveToTemp(combinedTempPath, 'batch')
      return {
        outputPath: combinedPath,
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
    forStream = false
  ): Promise<ActionResult> {
    const actionName = item.action.toLowerCase()
    switch (actionName) {
      case 'speak':
        return this.handleSpeak(preset, item, requestId, includeDebug, forStream)
      case 'idle':
        return this.handleIdle(preset, item, requestId, includeDebug, forStream)
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
    forStream = false
  ): Promise<ActionResult> {
    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      const plan = await this.buildSpeakPlan(preset, item, jobDir, requestId)
      const { outputPath, durationMs } = await this.mediaPipeline.compose({
        clips: plan.clips,
        audioPath: plan.audioPath,
        durationMs: plan.durationMs,
        jobDir,
      })

      const finalPath = await this.moveToTemp(outputPath, `speak-${requestId}`, forStream)
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
    forStream = false
  ): Promise<ActionResult> {
    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      const plan = await this.buildIdlePlanData(preset, item, requestId)
      const { outputPath, durationMs: actualDuration } = await this.mediaPipeline.compose({
        clips: plan.clips,
        durationMs: plan.requestedDurationMs,
        jobDir,
      })
      const finalPath = await this.moveToTemp(outputPath, `idle-${requestId}`, forStream)
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
      const finalPath = await this.moveToTemp(outputPath, `action-${requestId}`, forStream)
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

  private async moveToTemp(sourcePath: string, prefix: string, forStream = false): Promise<string> {
    const fileName = `${prefix}-${randomUUID()}.mp4`
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
    return this.buildSpeakPlan(preset, item, jobDir, requestId)
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
    const { voice, endpoint } = this.resolveVoiceProfile(preset, emotion)
    await this.voicevox.synthesize(text, audioPath, voice, { endpoint })
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

    const sttClient = new STTClient({ modelName: sttConfig.whisperModel })
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
    const plan = await this.buildIdlePlanData(preset, item, requestId)
    const audioPath = await this.mediaPipeline.createSilentAudio(plan.durationMs, jobDir)
    return {
      id: plan.id,
      action: plan.action,
      clips: plan.clips,
      motionIds: plan.motionIds,
      durationMs: plan.durationMs,
      audioPath,
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

  private resolveVoiceProfile(
    preset: ResolvedPreset,
    emotion: string | undefined
  ): { voice: VoicevoxVoiceOptions; endpoint: string } {
    const normalizedEmotion = (emotion ?? 'neutral').trim().toLowerCase()
    let matchingVoice: VoicevoxVoiceProfile | undefined
    let neutralVoice: VoicevoxVoiceProfile | undefined

    for (const voice of preset.audioProfile.voices) {
      if (voice.emotion === normalizedEmotion) {
        matchingVoice = voice
        break
      }
      if (!neutralVoice && voice.emotion === 'neutral') {
        neutralVoice = voice
      }
    }

    const selected = matchingVoice ?? neutralVoice ?? preset.audioProfile.defaultVoice
    return { voice: selected, endpoint: preset.audioProfile.voicevoxUrl }
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
}

export { ActionProcessingError }
