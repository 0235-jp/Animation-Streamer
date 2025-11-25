import NodeMediaServer from 'node-media-server'
import { logger } from '../utils/logger'

export interface RtmpServerOptions {
  outputUrl: string
}

const DEFAULT_APP = 'live'
const DEFAULT_KEY = 'main'
const DEFAULT_RTMP_PORT = 1935
const DEFAULT_HTTP_PORT = 8000

export class RtmpServer {
  private nms: any | null = null

  constructor(private readonly options: RtmpServerOptions) {}

  start(): void {
    if (this.nms) return

    const url = new URL(this.options.outputUrl)
    const port = url.port ? Number(url.port) : DEFAULT_RTMP_PORT
    const pathParts = url.pathname.replace(/^\/+/, '').split('/')
    const app = pathParts[0] || DEFAULT_APP
    const key = pathParts[1] || DEFAULT_KEY

    const config = {
      logType: 2,
      rtmp: {
        port,
        chunk_size: 60000,
        gop_cache: true,
        ping: 30,
        ping_timeout: 60,
      },
      streamApp: app,
      streamKey: key,
    }

    try {
      const nms = new NodeMediaServer(config)
      nms.run()
      this.nms = nms
      logger.info({ port, app, key }, 'RTMP server started')
    } catch (err) {
      logger.warn({ err }, 'Failed to start local RTMP server')
    }
  }

  stop(): void {
    if (!this.nms) return
    try {
      this.nms.stop()
      logger.info('RTMP server stopped')
    } catch (err) {
      logger.warn({ err }, 'Failed to stop RTMP server')
    } finally {
      this.nms = null
    }
  }
}
