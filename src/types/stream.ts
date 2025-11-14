export type StreamPhase = 'IDLE' | 'WAITING' | 'SPEECH' | 'STOPPED'

export interface StreamState {
  sessionId: string
  phase: StreamPhase
  activeMotionId?: string
  queueLength: number
  uptimeMs?: number
}

export interface StartRequest {
  sessionToken?: string
}

export interface StartResponse {
  status: string
  sessionId: string
  currentMotionId?: string
}

export interface StopResponse {
  status: string
}

export interface TextRequest {
  text: string
  motionId?: string
  metadata?: Record<string, unknown>
}

export interface TextResponse {
  message: string
  queueLength?: number
}

export interface StatusResponse {
  status: string
  currentMotionId?: string
  queueLength: number
  uptimeMs: number
}

export interface SpeechTask {
  id: string
  text: string
  motionId?: string
  metadata?: Record<string, unknown>
}
