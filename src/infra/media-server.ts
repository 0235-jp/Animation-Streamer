import NodeMediaServer from 'node-media-server';
import type { Logger } from 'pino';

const DEFAULT_CONFIG = {
  rtmp: {
    port: 1935,
    chunk_size: 60000,
    gop_cache: true,
    ping: 30,
    ping_timeout: 60
  },
  http: {
    port: 8000,
    allow_origin: '*'
  }
};

export class LocalMediaServer {
  private nms: NodeMediaServer | null = null;

  constructor(private readonly logger: Logger) {}

  start(): void {
    if (this.nms) {
      return;
    }
    this.nms = new NodeMediaServer(DEFAULT_CONFIG);
    this.nms.run();
    this.logger.info({ rtmpPort: DEFAULT_CONFIG.rtmp.port, httpPort: DEFAULT_CONFIG.http.port }, 'Local media server started');
  }
}
