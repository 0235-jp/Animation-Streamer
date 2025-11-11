export interface GenerateDefaults {
  emotion?: string
  idleMotionId?: string
}

export interface GenerateRequestItem {
  action: string
  params?: Record<string, unknown>
}

export interface GenerateRequestPayload {
  stream?: boolean
  defaults?: GenerateDefaults
  requests: GenerateRequestItem[]
  metadata?: Record<string, unknown>
}

export interface ActionResult {
  id: string
  action: string
  outputPath: string
  durationMs: number
  motionIds: string[]
  audioPath?: string
}

export interface StreamPushHandler {
  onResult?: (result: ActionResult) => void | Promise<void>
}
