export interface GenerateRequestItem {
  action: string
  params?: Record<string, unknown>
}

export interface GenerateRequestPayload {
  presetId: string
  stream?: boolean
  /** ライブストリームパイプライン用（output/streamに出力、実パスを返す） */
  forStreamPipeline?: boolean
  requests: GenerateRequestItem[]
  debug?: boolean
}

export interface ActionResult {
  id: string
  action: string
  outputPath: string
  durationMs: number
  motionIds?: string[]
  audioPath?: string
}

export interface StreamPushHandler {
  onResult?: (result: ActionResult) => void | Promise<void>
}
