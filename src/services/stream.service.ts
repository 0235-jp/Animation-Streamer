import { randomUUID } from 'crypto';
import type { Logger } from 'pino';
import type { StreamPhase, StreamStatusPayload } from '../types/stream';
import { WaitingLoopController } from './waiting-loop.controller';
import { AsyncLock } from '../utils/async-lock';

export class StreamService {
  private phase: StreamPhase = 'IDLE';
  private sessionId: string | null = null;
  private readonly lock = new AsyncLock();

  constructor(private readonly waitingLoop: WaitingLoopController, private readonly logger: Logger) {}

  async startWaiting(): Promise<StreamStatusPayload> {
    return this.lock.runExclusive(async () => {
      if (this.phase === 'WAITING') {
        this.logger.debug('startWaiting: already in WAITING state');
        return this.composeStatus();
      }

      await this.waitingLoop.start();
      this.phase = 'WAITING';
      if (!this.sessionId) {
        this.sessionId = randomUUID();
      }
      this.logger.info({ sessionId: this.sessionId }, 'Waiting loop started');
      return this.composeStatus();
    });
  }

  async stop(): Promise<StreamStatusPayload> {
    return this.lock.runExclusive(async () => {
      await this.waitingLoop.stop();
      this.phase = 'STOPPED';
      this.logger.info({ sessionId: this.sessionId }, 'Stream session stopped');
      return this.composeStatus();
    });
  }

  getStatus(): StreamStatusPayload {
    return this.composeStatus();
  }

  private composeStatus(): StreamStatusPayload {
    return {
      status: this.phase,
      sessionId: this.sessionId,
      currentMotionId: this.waitingLoop.activeMotionId,
      queueLength: 0
    };
  }
}
