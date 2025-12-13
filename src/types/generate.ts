export interface GenerateRequestItem {
  action: string
  params?: Record<string, unknown>
}

/**
 * speak アクションの音声入力オプション
 */
export interface AudioInput {
  /** 音声ファイルパス（サーバーローカル） */
  path?: string
  /** Base64エンコード音声データ */
  base64?: string
  /** true: STT→TTS, false/未指定: 直接使用 */
  transcribe?: boolean
}

/**
 * speak アクションのパラメータ
 * text または audio のいずれか一方を指定（排他）
 */
export interface SpeakParams {
  /** テキスト入力 → TTS → 音声 */
  text?: string
  /** 音声入力 */
  audio?: AudioInput
  /** 感情（モーション選択用） */
  emotion?: string
}

export interface GenerateRequestPayload {
  presetId: string
  stream?: boolean
  /** キャッシュを利用するか（デフォルト: false） */
  cache?: boolean
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
