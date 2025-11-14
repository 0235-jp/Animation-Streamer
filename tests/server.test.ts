import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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

    await import('../src/server')

    expect(listenMock).toHaveBeenCalledWith(4321, '0.0.0.0', expect.any(Function))
    expect(logger.info).toHaveBeenCalledWith({ port: 4321, host: '0.0.0.0' }, 'Server started')
  })

  it('prefers PORT environment variable when provided', async () => {
    process.env.PORT = '9999'
    process.env.HOST = '192.168.0.5'
    createAppMock.mockResolvedValue({
      app: {
        listen: listenMock.mockImplementation((_port, _host, cb) => {
          const callback = typeof _host === 'function' ? _host : cb
          callback?.()
        }),
      },
      config: { server: { port: 4321, host: '127.0.0.1' } },
    })

    await import('../src/server')

    expect(listenMock).toHaveBeenCalledWith(9999, '192.168.0.5', expect.any(Function))
    delete process.env.PORT
    delete process.env.HOST
  })

  it('logs and exits when app creation fails', async () => {
    createAppMock.mockRejectedValue(new Error('startup failure'))
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => undefined as never))

    await import('../src/server')
    await new Promise((resolve) => setImmediate(resolve))

    expect(logger.error).toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)
    exitSpy.mockRestore()
  })
})
