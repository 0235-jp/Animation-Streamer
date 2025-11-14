import NodeMediaServer from 'node-media-server'
import { logger } from '../utils/logger'

type ClientArgs = Record<string, unknown>
type PublishArgs = Record<string, unknown>

export interface MediaServerConfig {
  rtmpPort: number
  httpPort: number
}

export class MediaServer {
  private nms: NodeMediaServer
  private started = false

  constructor(config: MediaServerConfig) {
    this.nms = new NodeMediaServer({
      rtmp: {
        port: config.rtmpPort,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      http: {
        port: config.httpPort,
        mediaroot: './media',
        allow_origin: '*',
      },
      logType: 0, // Disable node-media-server's built-in logging
    })

    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    this.nms.on('preConnect', (id: string, args: ClientArgs) => {
      logger.debug({ id, args }, 'RTMP client connecting')
    })

    this.nms.on('postConnect', (id: string, args: ClientArgs) => {
      logger.info({ id, args }, 'RTMP client connected')
    })

    this.nms.on('doneConnect', (id: string, args: ClientArgs) => {
      logger.info({ id, args }, 'RTMP client disconnected')
    })

    this.nms.on('prePublish', (id: string, streamPath: string, args: PublishArgs) => {
      logger.info({ id, streamPath, args }, 'RTMP stream publishing')
    })

    this.nms.on('postPublish', (id: string, streamPath: string, args: PublishArgs) => {
      logger.info({ id, streamPath, args }, 'RTMP stream published')
    })

    this.nms.on('donePublish', (id: string, streamPath: string, args: PublishArgs) => {
      logger.info({ id, streamPath, args }, 'RTMP stream stopped')
    })
  }

  async start(): Promise<void> {
    if (this.started) {
      logger.warn('MediaServer already started')
      return
    }

    return new Promise((resolve, reject) => {
      try {
        this.nms.run()
        this.started = true
        logger.info('MediaServer started successfully')
        resolve()
      } catch (error) {
        logger.error({ err: error }, 'Failed to start MediaServer')
        reject(error)
      }
    })
  }

  async stop(): Promise<void> {
    if (!this.started) {
      logger.warn('MediaServer not started')
      return
    }

    return new Promise((resolve) => {
      try {
        this.nms.stop()
        this.started = false
        logger.info('MediaServer stopped')
        resolve()
      } catch (error) {
        logger.error({ err: error }, 'Error stopping MediaServer')
        resolve() // Resolve anyway to allow cleanup to continue
      }
    })
  }

  isStarted(): boolean {
    return this.started
  }
}
