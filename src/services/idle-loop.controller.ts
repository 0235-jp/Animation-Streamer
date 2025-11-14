import { spawn, type ChildProcess } from 'node:child_process'
import { logger } from '../utils/logger'
import type { StreamerConfig } from '../config/schema'

interface Motion {
  id: string
  path: string
  emotion: string
}

export interface IdleLoopControllerConfig {
  idleMotions: StreamerConfig['idleMotions']
  outputUrl: string
}

export class IdleLoopController {
  private ffmpegProcess: ChildProcess | null = null
  private currentMotionId: string | undefined
  private motionPool: Motion[]
  private outputUrl: string
  private isRunning = false

  constructor(config: IdleLoopControllerConfig) {
    this.outputUrl = config.outputUrl

    // Flatten idle motions into a single pool (Phase 1: simple implementation)
    this.motionPool = [
      ...config.idleMotions.large.map(m => ({ id: m.id, path: m.path, emotion: m.emotion })),
      ...config.idleMotions.small.map(m => ({ id: m.id, path: m.path, emotion: m.emotion })),
    ]

    if (this.motionPool.length === 0) {
      throw new Error('No idle motions configured')
    }

    logger.info({ motionCount: this.motionPool.length }, 'IdleLoopController initialized')
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('IdleLoopController already running')
      return
    }

    // Phase 1: Select first motion (Phase 2 will add random selection)
    const motion = this.motionPool[0]
    this.currentMotionId = motion.id

    logger.info({ motionId: motion.id, outputUrl: this.outputUrl }, 'Starting idle loop')

    // Use ffmpeg with stream_loop for infinite looping (Phase 1 simple approach)
    // Phase 2 will implement concat demuxer with stdin playlist
    this.ffmpegProcess = spawn('ffmpeg', [
      '-re',                          // Read input at native frame rate
      '-stream_loop', '-1',          // Loop infinitely
      '-i', motion.path,             // Input file
      '-c:v', 'copy',                // Copy video codec (no re-encoding)
      '-c:a', 'aac',                 // Audio codec (if present)
      '-f', 'flv',                   // Output format
      this.outputUrl,                // Output URL
    ])

    this.setupProcessHandlers()
    this.isRunning = true
  }

  private setupProcessHandlers(): void {
    if (!this.ffmpegProcess) return

    this.ffmpegProcess.stdout?.on('data', (data) => {
      logger.debug({ data: data.toString() }, 'ffmpeg stdout')
    })

    this.ffmpegProcess.stderr?.on('data', (data) => {
      // ffmpeg outputs progress to stderr
      const message = data.toString()
      if (message.includes('frame=') || message.includes('time=')) {
        logger.trace({ message }, 'ffmpeg progress')
      } else {
        logger.debug({ message }, 'ffmpeg stderr')
      }
    })

    this.ffmpegProcess.on('error', (error) => {
      logger.error({ err: error }, 'ffmpeg process error')
      this.isRunning = false
    })

    this.ffmpegProcess.on('exit', (code, signal) => {
      logger.info({ code, signal }, 'ffmpeg process exited')
      this.isRunning = false
      this.ffmpegProcess = null
      this.currentMotionId = undefined
    })
  }

  async stop(): Promise<void> {
    if (!this.ffmpegProcess || !this.isRunning) {
      logger.warn('IdleLoopController not running')
      return
    }

    logger.info('Stopping idle loop')

    return new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        logger.warn('ffmpeg did not respond to SIGTERM, sending SIGKILL')
        this.ffmpegProcess?.kill('SIGKILL')
        resolve()
      }, 5000)

      this.ffmpegProcess!.once('exit', () => {
        clearTimeout(timeout)
        this.isRunning = false
        this.currentMotionId = undefined
        logger.info('Idle loop stopped')
        resolve()
      })

      // Send SIGTERM for graceful shutdown
      this.ffmpegProcess!.kill('SIGTERM')
    })
  }

  getCurrentMotionId(): string | undefined {
    return this.currentMotionId
  }

  isActive(): boolean {
    return this.isRunning
  }

  // Placeholder for Phase 3
  async reserveNextClip(_clipPath: string): Promise<void> {
    throw new Error('reserveNextClip not implemented (Phase 3)')
  }
}
