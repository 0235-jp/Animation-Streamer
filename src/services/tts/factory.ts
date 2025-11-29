import type { TtsEngine } from './types'
import type { AudioProfile } from './schema'
import {
  VoicevoxCompatibleEngine,
  OpenAiTtsEngine,
  StyleBertVits2Engine,
  ElevenLabsEngine,
  GoogleTtsEngine,
  AzureTtsEngine,
} from './engines'

/**
 * 設定からTTSエンジンを生成するファクトリー
 *
 * @param profile audioProfile設定
 * @returns 対応するTTSエンジンインスタンス
 */
export function createTtsEngine(profile: AudioProfile): TtsEngine {
  switch (profile.ttsEngine) {
    // VOICEVOX互換エンジン
    case 'voicevox':
    case 'coeiroink':
    case 'aivis_speech':
      return new VoicevoxCompatibleEngine({
        engineType: profile.ttsEngine,
        url: profile.url,
      })

    // Style-Bert-VITS2
    case 'style_bert_vits2':
      return new StyleBertVits2Engine({
        url: profile.url,
        modelName: profile.modelName,
        style: profile.style,
        styleWeight: profile.styleWeight,
      })

    // OpenAI TTS
    case 'openai':
      return new OpenAiTtsEngine({
        apiKey: profile.apiKey,
        voice: profile.voice,
        model: profile.model,
      })

    // Google Cloud TTS
    case 'google':
      return new GoogleTtsEngine({
        apiKey: profile.apiKey ?? '',
        languageCode: profile.languageCode,
        voiceName: profile.voiceName,
      })

    // Azure TTS
    case 'azure':
      return new AzureTtsEngine({
        subscriptionKey: profile.subscriptionKey,
        region: profile.region,
        voiceName: profile.voiceName,
      })

    // ElevenLabs
    case 'elevenlabs':
      return new ElevenLabsEngine({
        apiKey: profile.apiKey,
        voiceId: profile.voiceId,
        modelId: profile.modelId,
        stability: profile.stability,
        similarityBoost: profile.similarityBoost,
      })

    default:
      // TypeScriptの網羅性チェック
      const _exhaustiveCheck: never = profile
      throw new Error(`未対応のTTSエンジン: ${(_exhaustiveCheck as AudioProfile).ttsEngine}`)
  }
}
