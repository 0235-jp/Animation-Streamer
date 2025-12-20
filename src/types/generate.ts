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

/**
 * speakLipSync アクションのパラメータ
 * text または audio のいずれか一方を指定（排他）
 */
export interface SpeakLipSyncParams {
  /** テキスト入力 → TTS → 音声 */
  text?: string
  /** 音声入力（transcribe: true必須） */
  audio?: AudioInput
  /** 感情（リップシンク画像セット選択用） */
  emotion?: string
}

/**
 * VOICEVOX audio_queryのモーラ情報
 */
export interface VoicevoxMora {
  text: string
  consonant?: string | null
  consonant_length?: number | null
  vowel: string
  vowel_length: number
  pitch: number
}

/**
 * VOICEVOX audio_queryのアクセント句
 */
export interface VoicevoxAccentPhrase {
  moras: VoicevoxMora[]
  accent: number
  pause_mora?: VoicevoxMora | null
}

/**
 * VOICEVOX audio_queryレスポンス
 */
export interface VoicevoxAudioQueryResponse {
  accent_phrases: VoicevoxAccentPhrase[]
  speedScale: number
  pitchScale: number
  intonationScale: number
  volumeScale: number
  prePhonemeLength: number
  postPhonemeLength: number
  outputSamplingRate: number
  outputStereo: boolean
  kana?: string
}

/**
 * ビゼムタイプ
 */
export type VisemeType = 'a' | 'i' | 'u' | 'e' | 'o' | 'N' | 'closed'

/**
 * ビゼムセグメント（タイムライン上の1区間）
 */
export interface VisemeSegment {
  viseme: VisemeType
  startMs: number
  endMs: number
}
