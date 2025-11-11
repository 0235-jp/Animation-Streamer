declare module 'node-media-server' {
  import { EventEmitter } from 'events';

  export interface NodeMediaServerOptions {
    rtmp?: {
      port?: number;
      chunk_size?: number;
      gop_cache?: boolean;
      ping?: number;
      ping_timeout?: number;
    };
    http?: {
      port?: number;
      allow_origin?: string;
    };
    https?: unknown;
    trans?: unknown;
  }

  export default class NodeMediaServer extends EventEmitter {
    constructor(config: NodeMediaServerOptions);
    run(): void;
    stop(): void;
  }
}
