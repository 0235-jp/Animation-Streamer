import { createApp } from './app'
import { logger } from './utils/logger'

export interface StartOptions {
  exit?: (code?: number) => never
}

export const start = async (options: StartOptions = {}) => {
  try {
    const { app, config } = await createApp()
    const port = Number(process.env.PORT ?? config.server.port ?? 4000)
    const host = process.env.HOST ?? config.server.host ?? 'localhost'
    app.listen(port, host, () => {
      logger.info({ port, host }, 'Server started')
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server')
    const exit = options.exit ?? ((code?: number) => process.exit(code))
    exit(1)
  }
}

const isMainModule = typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module

if (isMainModule) {
  void start()
}
