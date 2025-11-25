import { randomUUID } from 'crypto'
import path from 'node:path'
import type { ResolvedConfig, ResolvedPreset } from '../config/loader'
import type { ClipPlanner } from './clip-planner'
import { IdleLoopController } from './idle-loop.controller'
import type { GenerationService } from './generation.service'
import type { GenerateRequestPayload } from '../types/generate'
import { logger } from '../utils/logger'
import type { MediaPipeline } from './media-pipeline'

export type StreamPhase = 'STOPPED' | 'IDLE' | 'SPEAK'

export interface StreamStateSnapshot {
  sessionId: string | null
  presetId: string | null
  phase: StreamPhase
  activeMotionId?: string
  queueLength: number
}

export interface StreamStartOptions {
  debug?: boolean
}

export class StreamService {
  private state: StreamStateSnapshot = {
    sessionId: null,
    presetId: null,
    phase: 'STOPPED',
    queueLength: 0,
  }
  private idleLoop: IdleLoopController | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly config: ResolvedConfig,
    private readonly clipPlanner: ClipPlanner,
    private readonly mediaPipeline: MediaPipeline,
    private readonly generationService: GenerationService
  ) {}

  private ensurePreset(presetId: string): ResolvedPreset {
    const preset = this.config.presets.find((p) => p.id === presetId)
    if (!preset) {
      const err = new Error(`Preset not found: ${presetId}`)
      ;(err as any).statusCode = 400
      throw err
    }
    return preset
  }

  async start(presetId: string, options: StreamStartOptions = {}): Promise<StreamStateSnapshot> {
    const preset = this.ensurePreset(presetId)
    const debug = options.debug ?? false

    if (this.state.phase !== 'STOPPED' && this.state.presetId !== presetId) {
      const err = new Error('Stream is already running with a different preset')
      ;(err as any).statusCode = 409
      throw err
    }

    if (this.state.phase !== 'STOPPED' && this.state.presetId === presetId && this.idleLoop) {
      return { ...this.state }
    }

    const sessionId = randomUUID()
    this.state = {
      sessionId,
      presetId,
      phase: 'IDLE',
      queueLength: 0,
    }
    const workDir = path.join(this.config.paths.outputDir, 'stream')
    this.idleLoop = new IdleLoopController({
      clipPlanner: this.clipPlanner,
      mediaPipeline: this.mediaPipeline,
      workDir,
      outputUrl: this.config.rtmp.outputUrl,
      debug,
    })
    try {
      await this.idleLoop.start(preset)
    } catch (error) {
      this.state = { sessionId: null, presetId: null, phase: 'STOPPED', queueLength: 0 }
      this.idleLoop = null
      throw error
    }
    return { ...this.state }
  }

  stop(): StreamStateSnapshot {
    void this.idleLoop?.stop()
    this.idleLoop = null
    this.state = {
      sessionId: null,
      presetId: null,
      phase: 'STOPPED',
      queueLength: 0,
    }
    return { ...this.state }
  }

  status(): StreamStateSnapshot {
    return { ...this.state }
  }

  enqueueText(payload: GenerateRequestPayload): Promise<void> {
    if (this.state.phase === 'STOPPED') {
      const err = new Error('Stream is not started')
      ;(err as any).statusCode = 409
      return Promise.reject(err)
    }
    if (!this.state.presetId || this.state.presetId !== payload.presetId) {
      const err = new Error('presetId does not match running stream')
      ;(err as any).statusCode = 409
      return Promise.reject(err)
    }
    this.state.queueLength += 1
    this.state.phase = 'SPEAK'
    const task = async () => {
      try {
        const streamPayload: GenerateRequestPayload = { ...payload, stream: true, forStreamPipeline: true }
        const result = await this.generationService.processBatch(streamPayload)
        if (result.kind !== 'stream') {
          throw new Error('Unexpected result kind for stream payload')
        }
        for (const action of result.results) {
          if (!this.idleLoop) throw new Error('Stream is not running')
          await this.idleLoop.insertTask(
            [
              {
                id: action.id,
                path: action.outputPath,
                durationMs: action.durationMs,
              },
            ],
            payload.presetId
          )
        }
      } finally {
        this.state.queueLength = Math.max(0, this.state.queueLength - 1)
        if (this.state.queueLength === 0 && this.state.phase !== 'STOPPED') {
          this.state.phase = 'IDLE'
        }
      }
    }
    this.queue = this.queue.then(() => task()).catch((err) => {
      // エラーはログのみで後続タスクを潰さない
      logger.error({ err }, 'Stream task failed')
    })
    return this.queue
  }
}
