import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ResolvedAction, ResolvedConfig } from '../config/loader'
import { ClipPlanner } from './clip-planner'
import { MediaPipeline, type ClipSource, NoAudioTrackError } from './media-pipeline'
import { VoicevoxClient } from './voicevox'
import type { ActionResult, GenerateDefaults, GenerateRequestItem, GenerateRequestPayload, StreamPushHandler } from '../types/generate'
import { logger } from '../utils/logger'

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
  private readonly actionsMap: Map<string, ResolvedAction>

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
    this.actionsMap = new Map(deps.config.actions.map((action) => [action.id, action]))
  }

  async processBatch(
    payload: GenerateRequestPayload,
    handler?: StreamPushHandler
  ): Promise<StreamBatchResult | CombinedBatchResult> {
    const defaults: GenerateDefaults = {
      emotion: payload.defaults?.emotion ?? 'neutral',
      idleMotionId: payload.defaults?.idleMotionId,
    }
    const includeDebug = Boolean(payload.debug)
    const indexedRequests: IndexedRequest[] = payload.requests.map((item, index) => ({
      item,
      requestId: String(index + 1),
    }))

    if (payload.stream) {
      const results = await this.processStreamingBatch(indexedRequests, defaults, includeDebug, handler)
      return { kind: 'stream', results }
    }
    const combined = await this.processCombinedBatch(indexedRequests, defaults, includeDebug)
    return { kind: 'combined', result: combined }
  }

  private async processStreamingBatch(
    indexedRequests: IndexedRequest[],
    defaults: GenerateDefaults,
    includeDebug: boolean,
    handler?: StreamPushHandler
  ): Promise<ActionResult[]> {
    const results: ActionResult[] = []
    for (const { item, requestId } of indexedRequests) {
      try {
        const result = await this.processSingle(item, defaults, requestId, includeDebug)
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
    defaults: GenerateDefaults,
    includeDebug: boolean
  ): Promise<CombinedResult> {
    const plannedActions: PlannedAction[] = []
    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      for (const { item, requestId } of indexedRequests) {
        try {
          const planned = await this.planAction(item, defaults, jobDir, requestId)
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
    item: GenerateRequestItem,
    defaults: GenerateDefaults,
    requestId: string,
    includeDebug: boolean
  ): Promise<ActionResult> {
    const actionName = item.action.toLowerCase()
    switch (actionName) {
      case 'speak':
        return this.handleSpeak(item, defaults, requestId, includeDebug)
      case 'idle':
        return this.handleIdle(item, defaults, requestId, includeDebug)
      default:
        return this.handleCustomAction(item, requestId, includeDebug)
    }
  }

  private async planAction(
    item: GenerateRequestItem,
    defaults: GenerateDefaults,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    const actionName = item.action.toLowerCase()
    switch (actionName) {
      case 'speak':
        return this.planSpeakAction(item, defaults, jobDir, requestId)
      case 'idle':
        return this.planIdleAction(item, defaults, jobDir, requestId)
      default:
        return this.planCustomAction(item, jobDir, requestId)
    }
  }

  private async handleSpeak(
    item: GenerateRequestItem,
    defaults: GenerateDefaults,
    requestId: string,
    includeDebug: boolean
  ): Promise<ActionResult> {
    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      const plan = await this.buildSpeakPlan(item, defaults, jobDir, requestId)
      const { outputPath, durationMs } = await this.mediaPipeline.compose({
        clips: plan.clips,
        audioPath: plan.audioPath,
        durationMs: plan.durationMs,
        jobDir,
      })

      const finalPath = await this.moveToTemp(outputPath, `speak-${requestId}`)
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
    item: GenerateRequestItem,
    defaults: GenerateDefaults,
    requestId: string,
    includeDebug: boolean
  ): Promise<ActionResult> {
    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      const plan = await this.buildIdlePlanData(item, defaults, requestId)
      const { outputPath, durationMs: actualDuration } = await this.mediaPipeline.compose({
        clips: plan.clips,
        durationMs: plan.requestedDurationMs,
        jobDir,
      })
      const finalPath = await this.moveToTemp(outputPath, `idle-${requestId}`)
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
    item: GenerateRequestItem,
    requestId: string,
    includeDebug: boolean
  ): Promise<ActionResult> {
    const [plan] = await this.buildCustomActionPlanData(item, requestId)
    const jobDir = await this.mediaPipeline.createJobDir()
    try {
      const { outputPath, durationMs } = await this.mediaPipeline.compose({
        clips: plan.clips,
        durationMs: plan.durationMs,
        jobDir,
      })
      const finalPath = await this.moveToTemp(outputPath, `action-${requestId}`)
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

  private async moveToTemp(sourcePath: string, prefix: string): Promise<string> {
    const fileName = `${prefix}-${randomUUID()}.mp4`
    const destination = path.join(this.config.assets.absoluteTempDir, fileName)
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
    logger.info({ destination }, 'Generated clip')
    return destination
  }

  private async planSpeakAction(
    item: GenerateRequestItem,
    defaults: GenerateDefaults,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    return this.buildSpeakPlan(item, defaults, jobDir, requestId)
  }

  private async buildSpeakPlan(
    item: GenerateRequestItem,
    defaults: GenerateDefaults,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    const params = item.params ?? {}
    const text = this.ensureString(params.text, 'text', requestId)
    const emotion = this.ensureOptionalString(params.emotion) ?? defaults.emotion ?? 'neutral'

    const audioPath = path.join(jobDir, `voice-${requestId}.wav`)
    await this.voicevox.synthesize(text, audioPath)
    const normalizedAudio = await this.mediaPipeline.normalizeAudio(audioPath, jobDir, `voice-${requestId}`)
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
    const plan = await this.clipPlanner.buildSpeechPlan(emotion, audioDuration)
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

  private async planIdleAction(
    item: GenerateRequestItem,
    defaults: GenerateDefaults,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    const plan = await this.buildIdlePlanData(item, defaults, requestId)
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
    item: GenerateRequestItem,
    jobDir: string,
    requestId: string
  ): Promise<PlannedAction> {
    const [plan, actionConfig] = await this.buildCustomActionPlanData(item, requestId)
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

  private async buildIdlePlanData(
    item: GenerateRequestItem,
    defaults: GenerateDefaults,
    requestId: string
  ): Promise<IdlePlanData> {
    const params = item.params ?? {}
    const durationMs = this.ensurePositiveNumber(params.durationMs, 'durationMs', requestId)
    const motionId = this.ensureOptionalString(params.motionId) ?? defaults.idleMotionId
    const emotion = this.ensureOptionalString(params.emotion)
    const plan = await this.clipPlanner.buildIdlePlan(durationMs, motionId, emotion)
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
    item: GenerateRequestItem,
    requestId: string
  ): Promise<[BaseActionPlan, ResolvedAction]> {
    const actionName = item.action.toLowerCase()
    if (actionName === 'speak' || actionName === 'idle') {
      throw new ActionProcessingError('予約語はactionsに登録できません', requestId)
    }
    const action = this.actionsMap.get(actionName)
    if (!action) {
      throw new ActionProcessingError(`未定義のアクションです: ${item.action}`, requestId)
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
}

export { ActionProcessingError }
