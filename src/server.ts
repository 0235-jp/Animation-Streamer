import { createApp } from './app'
import { logger } from './utils/logger'

const start = async () => {
  try {
    const { app, config } = await createApp()
    const port = Number(process.env.PORT ?? config.server.port ?? 4000)
    const host = process.env.HOST ?? config.server.host ?? 'localhost'
    app.listen(port, host, () => {
      logger.info({ port, host }, 'Server started')
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server')
    process.exit(1)
  }
}

void start()
