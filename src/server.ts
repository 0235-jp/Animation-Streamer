import { createApp } from './app'
import { logger } from './utils/logger'

const start = async () => {
  try {
    const { app, config } = await createApp()
    const port = Number(process.env.PORT ?? config.server.port ?? 4000)
    app.listen(port, () => {
      logger.info({ port }, 'Server started')
    })
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server')
    process.exit(1)
  }
}

void start()
