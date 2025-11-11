import { spawn, type ChildProcess } from 'child_process';
import { randomInt } from 'crypto';
import { once } from 'events';
import type { Logger } from 'pino';
import type { MotionAsset } from '../types/stream';

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3000;

export class WaitingLoopController {
  private ffmpegProcess: ChildProcess | null = null;
  private running = false;
  private currentMotionId: string | null = null;

  constructor(
    private readonly motions: MotionAsset[],
    private readonly outputUrl: string,
    private readonly logger: Logger,
    private readonly ffmpegPath = process.env.FFMPEG_BIN || 'ffmpeg'
  ) {
    if (motions.length === 0) {
      throw new Error('WaitingLoopController requires at least one motion');
    }
  }

  get isRunning(): boolean {
    return this.running;
  }

  get activeMotionId(): string | null {
    return this.currentMotionId;
  }

  async start(): Promise<void> {
    if (this.running) {
      this.logger.debug('Waiting loop already running');
      return;
    }

    const motion = this.pickNextMotion(null);
    this.currentMotionId = motion.id;

    this.logger.info({ motionId: motion.id, motionPath: motion.path }, 'Starting waiting loop ffmpeg process');
    this.ffmpegProcess = spawn(this.ffmpegPath, [
      '-hide_banner',
      '-loglevel',
      process.env.FFMPEG_LOG_LEVEL || 'error',
      '-stream_loop',
      '-1',
      '-re',
      '-i',
      motion.path,
      '-c',
      'copy',
      '-f',
      'flv',
      this.outputUrl
    ], { stdio: ['ignore', 'inherit', 'inherit'] });
    const ffmpegProcess = this.ffmpegProcess;

    ffmpegProcess.on('error', (err) => {
      this.logger.error({ err }, 'ffmpeg process error');
    });

    ffmpegProcess.on('close', (code, signal) => {
      this.logger.warn({ code, signal }, 'ffmpeg process closed');
      this.running = false;
      this.ffmpegProcess = null;
      this.currentMotionId = null;
    });

    this.running = true;
  }

  async stop(): Promise<void> {
    if (!this.running) {
      return;
    }
    this.logger.info('Stopping waiting loop');
    this.running = false;

    if (this.ffmpegProcess) {
      const proc = this.ffmpegProcess;
      const killTimer = setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL');
        }
      }, DEFAULT_SHUTDOWN_TIMEOUT_MS);

      proc.kill('SIGTERM');
      try {
        await once(proc, 'close');
      } catch (err) {
        this.logger.warn({ err }, 'Error while waiting for ffmpeg to close');
      } finally {
        clearTimeout(killTimer);
      }
    }

    this.ffmpegProcess = null;
    this.currentMotionId = null;
  }

  private pickNextMotion(lastMotionId: string | null): MotionAsset {
    if (this.motions.length === 1) {
      return this.motions[0];
    }

    let nextIndex = randomInt(this.motions.length);
    if (lastMotionId && this.motions[nextIndex].id === lastMotionId) {
      nextIndex = (nextIndex + 1) % this.motions.length;
    }
    return this.motions[nextIndex];
  }
}
