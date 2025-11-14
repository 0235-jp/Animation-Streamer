import AsyncLock from 'async-lock'
import { randomUUID } from 'node:crypto'
import { logger } from '../utils/logger'
import { IdleLoopController } from './idle-loop.controller'
import type { StreamState, StreamPhase, StartRequest, StartResponse, StopResponse, StatusResponse, TextRequest } from '../types/stream'

export interface StreamServiceConfig {
  idleLoopController: IdleLoopController
}

export class StreamService {
  private lock = new AsyncLock()
  private state: StreamState
  private idleLoopController: IdleLoopController
  private startTime: number | null = null

  constructor(config: StreamServiceConfig) {
    this.idleLoopController = config.idleLoopController
    this.state = {
      sessionId: '',
      phase: 'IDLE',
      queueLength: 0,
    }

    logger.info('StreamService initialized')
  }

  async start(request: StartRequest): Promise<StartResponse> {
    return this.lock.acquire('state', async () => {
      logger.info({ currentPhase: this.state.phase, request }, 'Starting stream')

      if (this.state.phase === 'WAITING' || this.state.phase === 'SPEECH') {
        logger.warn('Stream already started')
        return {
          status: this.state.phase,
          sessionId: this.state.sessionId,
          currentMotionId: this.state.activeMotionId,
        }
      }

      // Generate new session ID
      this.state.sessionId = randomUUID()
      this.startTime = Date.now()

      // Start idle loop
      await this.idleLoopController.start()

      // Update state
      this.state.phase = 'WAITING'
      this.state.activeMotionId = this.idleLoopController.getCurrentMotionId()

      logger.info({ sessionId: this.state.sessionId, motionId: this.state.activeMotionId }, 'Stream started')

      return {
        status: 'WAITING',
        sessionId: this.state.sessionId,
        currentMotionId: this.state.activeMotionId,
      }
    })
  }

  async stop(): Promise<StopResponse> {
    return this.lock.acquire('state', async () => {
      logger.info({ currentPhase: this.state.phase }, 'Stopping stream')

      if (this.state.phase === 'IDLE' || this.state.phase === 'STOPPED') {
        logger.warn('Stream not started')
        return { status: 'STOPPED' }
      }

      // Stop idle loop
      await this.idleLoopController.stop()

      // Update state
      this.state.phase = 'STOPPED'
      this.state.activeMotionId = undefined
      this.state.queueLength = 0
      this.startTime = null

      logger.info('Stream stopped')

      return { status: 'STOPPED' }
    })
  }

  getStatus(): StatusResponse {
    const uptimeMs = this.startTime ? Date.now() - this.startTime : 0

    return {
      status: this.state.phase,
      currentMotionId: this.state.activeMotionId,
      queueLength: this.state.queueLength,
      uptimeMs,
    }
  }

  // Phase 3: text endpoint implementation
  async enqueueText(_request: TextRequest): Promise<void> {
    throw new Error('enqueueText not implemented (Phase 3)')
  }

  getPhase(): StreamPhase {
    return this.state.phase
  }
}
