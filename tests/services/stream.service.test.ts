import { describe, it, expect, beforeEach, vi } from 'vitest'
import { StreamService } from '../../src/services/stream.service'
import type { IdleLoopController } from '../../src/services/idle-loop.controller'

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'session-123'),
}))

const createIdleLoopMock = () => ({
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  getCurrentMotionId: vi.fn().mockReturnValue('idle-large'),
  isActive: vi.fn().mockReturnValue(true),
  reserveNextClip: vi.fn(),
})

describe('StreamService', () => {
  let idleLoop: ReturnType<typeof createIdleLoopMock>
  let service: StreamService

  beforeEach(() => {
    idleLoop = createIdleLoopMock()
    service = new StreamService({ idleLoopController: idleLoop as unknown as IdleLoopController })
  })

  it('starts idle loop and transitions to WAITING state', async () => {
    const response = await service.start({})

    expect(idleLoop.start).toHaveBeenCalledTimes(1)
    expect(response).toEqual({
      status: 'WAITING',
      sessionId: 'session-123',
      currentMotionId: 'idle-large',
    })

    const status = service.getStatus()
    expect(status.status).toBe('WAITING')
    expect(status.currentMotionId).toBe('idle-large')
    expect(status.queueLength).toBe(0)
    expect(status.uptimeMs).toBeGreaterThanOrEqual(0)
  })

  it('avoids restarting when stream already active', async () => {
    await service.start({})
    idleLoop.getCurrentMotionId.mockReturnValue('idle-small')

    const response = await service.start({})

    expect(idleLoop.start).toHaveBeenCalledTimes(1)
    expect(response.status).toBe('WAITING')
    expect(response.currentMotionId).toBe('idle-large')
  })

  it('stops idle loop and moves to STOPPED state', async () => {
    await service.start({})

    const response = await service.stop()

    expect(idleLoop.stop).toHaveBeenCalledTimes(1)
    expect(response).toEqual({ status: 'STOPPED' })
    const status = service.getStatus()
    expect(status.status).toBe('STOPPED')
    expect(status.currentMotionId).toBeUndefined()
    expect(status.queueLength).toBe(0)
    expect(status.uptimeMs).toBe(0)
  })

  it('treats stop calls while IDLE as no-ops', async () => {
    const response = await service.stop()

    expect(idleLoop.stop).not.toHaveBeenCalled()
    expect(response).toEqual({ status: 'STOPPED' })
  })
})
