import { describe, it, expect, vi, beforeEach } from 'vitest'

const listenMock = vi.fn()
const createAppMock = vi.fn()

vi.mock('../src/app', () => ({
  createApp: createAppMock,
}))

const logger = {
  info: vi.fn(),
  error: vi.fn(),
}

vi.mock('../src/utils/logger', () => ({
  logger,
}))

describe('server bootstrap', () => {
  beforeEach(() => {
    vi.resetModules()
    createAppMock.mockReset()
    listenMock.mockReset()
    logger.info.mockReset()
    logger.error.mockReset()
  })

  it('listens on config port when no PORT env is provided', async () => {
    createAppMock.mockResolvedValue({
      app: {
        listen: listenMock.mockImplementation((_port, _host, cb) => {
          const callback = typeof _host === 'function' ? _host : cb
          callback?.()
        }),
      },
      config: { server: { port: 4321, host: '0.0.0.0' } },
    })

    const { start } = await import('../src/server')
    await start()

    expect(listenMock).toHaveBeenCalledWith(4321, '0.0.0.0', expect.any(Function))
    expect(logger.info).toHaveBeenCalledWith({ port: 4321, host: '0.0.0.0' }, 'Server started')
  })

  it('logs and exits when app creation fails', async () => {
    createAppMock.mockRejectedValue(new Error('startup failure'))
    const exitSpy = vi.fn()
    const exitStub = (code?: number) => {
      exitSpy(code)
      return undefined as never
    }

    const { start } = await import('../src/server')
    await start({ exit: exitStub })
    await new Promise((resolve) => setImmediate(resolve))

    expect(logger.error).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
