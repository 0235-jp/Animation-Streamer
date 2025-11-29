/**
 * TTS (Text-to-Speech) エンジンの抽象化インターフェース
 *
 * 対応エンジン:
 * - voicevox: VOICEVOX (ローカルサーバー)
 * - coeiroink: COEIROINK (VOICEVOX互換API)
 * - aivis_speech: AivisSpeech Engine (VOICEVOX互換API)
 * - style_bert_vits2: Style-Bert-VITS2 (ローカルサーバー)
 * - openai: OpenAI TTS (クラウドAPI)
 * - google: Google Cloud Text-to-Speech (クラウドAPI)
 * - azure: Microsoft Azure TTS (クラウドAPI)
 * - elevenlabs: ElevenLabs (クラウドAPI)
 */

/** サポートするTTSエンジンの種類 */
export type TtsEngineType =
  | 'voicevox'
  | 'coeiroink'
  | 'aivis_speech'
  | 'style_bert_vits2'
  | 'openai'
  | 'google'
  | 'azure'
  | 'elevenlabs'

/** VOICEVOX互換エンジンの種類 */
export type VoicevoxCompatibleEngineType = 'voicevox' | 'coeiroink' | 'aivis_speech'

/** 音声合成の共通パラメータ */
export interface TtsSynthesisParams {
  /** 話速 (1.0 = 標準) */
  speedScale?: number
  /** ピッチ (0.0 = 標準) */
  pitchScale?: number
  /** 抑揚 (1.0 = 標準) */
  intonationScale?: number
  /** 音量 (1.0 = 標準) */
  volumeScale?: number
  /** 出力サンプリングレート */
  outputSamplingRate?: number
  /** ステレオ出力 */
  outputStereo?: boolean
}

/** 音声プロファイル（感情別の音声設定） */
export interface TtsVoiceProfile extends TtsSynthesisParams {
  /** 感情ラベル (neutral, happy, sad, angry, etc.) */
  emotion: string
}

/** VOICEVOX互換エンジン用の音声プロファイル */
export interface VoicevoxVoiceProfile extends TtsVoiceProfile {
  /** 話者ID */
  speakerId: number
}

/** OpenAI TTS用の音声プロファイル */
export interface OpenAiVoiceProfile extends TtsVoiceProfile {
  /** 音声名 (alloy, echo, fable, onyx, nova, shimmer) */
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
  /** モデル (tts-1, tts-1-hd) */
  model?: 'tts-1' | 'tts-1-hd'
}

/** ElevenLabs用の音声プロファイル */
export interface ElevenLabsVoiceProfile extends TtsVoiceProfile {
  /** 音声ID */
  voiceId: string
  /** モデルID */
  modelId?: string
  /** 安定性 (0.0-1.0) */
  stability?: number
  /** 類似性ブースト (0.0-1.0) */
  similarityBoost?: number
}

/** Style-Bert-VITS2用の音声プロファイル */
export interface StyleBertVits2VoiceProfile extends TtsVoiceProfile {
  /** モデル名 */
  modelName: string
  /** スタイル */
  style?: string
  /** スタイルの強さ (0.0-1.0) */
  styleWeight?: number
}

/** Google Cloud TTS用の音声プロファイル */
export interface GoogleTtsVoiceProfile extends TtsVoiceProfile {
  /** 言語コード (ja-JP, en-US, etc.) */
  languageCode: string
  /** 音声名 */
  voiceName: string
}

/** Azure TTS用の音声プロファイル */
export interface AzureTtsVoiceProfile extends TtsVoiceProfile {
  /** 音声名 */
  voiceName: string
  /** スタイル (cheerful, sad, angry, etc.) */
  style?: string
  /** スタイルの度合い */
  styleDegree?: number
}

/** 音声合成オプション */
export interface TtsSynthesizeOptions {
  /** エンドポイントURL（オーバーライド用） */
  endpoint?: string
}

/** TTSエンジンの共通インターフェース */
export interface TtsEngine {
  /** エンジンの種類 */
  readonly engineType: TtsEngineType

  /**
   * テキストを音声に変換してファイルに保存
   * @param text 合成するテキスト
   * @param outputPath 出力ファイルパス (.wav)
   * @param voice 音声プロファイル
   * @param options 追加オプション
   * @returns 出力ファイルパス
   */
  synthesize(
    text: string,
    outputPath: string,
    voice: TtsVoiceProfile,
    options?: TtsSynthesizeOptions
  ): Promise<string>
}

/** VOICEVOX互換エンジンの追加インターフェース */
export interface VoicevoxCompatibleTtsEngine extends TtsEngine {
  readonly engineType: VoicevoxCompatibleEngineType

  synthesize(
    text: string,
    outputPath: string,
    voice: VoicevoxVoiceProfile,
    options?: TtsSynthesizeOptions
  ): Promise<string>
}
