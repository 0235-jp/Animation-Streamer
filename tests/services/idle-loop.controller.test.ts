import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { IdleLoopController, type IdleLoopControllerConfig } from '../../src/services/idle-loop.controller'

type MockChildProcess = ChildProcess &
  EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    kill: ReturnType<typeof vi.fn>
  }

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}))

vi.mock('node:child_process', () => ({
  spawn: spawnMock,
}))

const createMockProcess = (): MockChildProcess => {
  const process = new EventEmitter() as MockChildProcess
  process.stdout = new EventEmitter()
  process.stderr = new EventEmitter()
  process.kill = vi.fn()
  return process
}

const createController = () => {
  const controllerConfig: IdleLoopControllerConfig = {
    outputUrl: 'rtmp://127.0.0.1:1935/live/main',
    idleMotions: {
      large: [{ id: 'idle-large', emotion: 'neutral', path: '/videos/idle-large.mp4' }],
      small: [{ id: 'idle-small', emotion: 'neutral', path: '/videos/idle-small.mp4' }],
    },
  }
  return new IdleLoopController(controllerConfig)
}

describe('IdleLoopController', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns ffmpeg with the first idle motion and marks controller active', async () => {
    const process = createMockProcess()
    spawnMock.mockReturnValue(process)
    const controller = createController()

    await controller.start()

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(spawnMock).toHaveBeenCalledWith('ffmpeg', [
      '-re',
      '-stream_loop',
      '-1',
      '-i',
      '/videos/idle-large.mp4',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-f',
      'flv',
      'rtmp://127.0.0.1:1935/live/main',
    ])
    expect(controller.isActive()).toBe(true)
    expect(controller.getCurrentMotionId()).toBe('idle-large')
  })

  it('does not spawn another process when already running', async () => {
    const process = createMockProcess()
    spawnMock.mockReturnValue(process)
    const controller = createController()

    await controller.start()
    await controller.start()

    expect(spawnMock).toHaveBeenCalledTimes(1)
  })

  it('sends SIGTERM and resolves stop after ffmpeg exits', async () => {
    const process = createMockProcess()
    spawnMock.mockReturnValue(process)
    const controller = createController()
    await controller.start()

    const stopPromise = controller.stop()
    expect(process.kill).toHaveBeenCalledWith('SIGTERM')

    process.emit('exit', 0, null)
    await stopPromise

    expect(controller.isActive()).toBe(false)
    expect(controller.getCurrentMotionId()).toBeUndefined()
  })

  it('forces SIGKILL when ffmpeg ignores SIGTERM', async () => {
    vi.useFakeTimers()
    const process = createMockProcess()
    spawnMock.mockReturnValue(process)
    const controller = createController()
    await controller.start()

    const stopPromise = controller.stop()
    expect(process.kill).toHaveBeenCalledWith('SIGTERM')

    await vi.advanceTimersByTimeAsync(5000)
    expect(process.kill).toHaveBeenCalledWith('SIGKILL')

    process.emit('exit', 0, null)
    await stopPromise
  })
})
