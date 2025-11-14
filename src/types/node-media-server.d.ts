declare module 'node-media-server' {
  interface RtmpConfig {
    port: number
    chunk_size?: number
    gop_cache?: boolean
    ping?: number
    ping_timeout?: number
  }

  interface HttpConfig {
    port: number
    mediaroot?: string
    allow_origin?: string
  }

  interface NodeMediaServerConfig {
    rtmp?: RtmpConfig
    http?: HttpConfig
    logType?: number
    [key: string]: unknown
  }

  interface NodeMediaServerEventPayloads {
    preConnect: [id: string, args: Record<string, unknown>]
    postConnect: [id: string, args: Record<string, unknown>]
    doneConnect: [id: string, args: Record<string, unknown>]
    prePublish: [id: string, streamPath: string, args: Record<string, unknown>]
    postPublish: [id: string, streamPath: string, args: Record<string, unknown>]
    donePublish: [id: string, streamPath: string, args: Record<string, unknown>]
    [event: string]: unknown[]
  }

  type NodeMediaServerEvent = keyof NodeMediaServerEventPayloads

  export default class NodeMediaServer {
    constructor(config?: NodeMediaServerConfig)
    run(): void
    stop(): void
    on<K extends NodeMediaServerEvent>(
      event: K,
      listener: (...args: NodeMediaServerEventPayloads[K]) => void
    ): void
  }
}
