import { promises as fs } from 'node:fs'
import { fetch } from 'undici'
import type { TtsEngine, TtsSynthesizeOptions, ElevenLabsVoiceProfile } from '../types'
import { logger } from '../../../utils/logger'

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1'

export interface ElevenLabsConfig {
  /** ElevenLabs APIキー（必須） */
  apiKey: string
  /** 音声ID（必須） */
  voiceId: string
  /** モデルID（必須） */
  modelId: string
  /** 安定性（オプション） */
  stability?: number
  /** 類似性ブースト（オプション） */
  similarityBoost?: number
}

/**
 * ElevenLabs TTS エンジン
 *
 * エンドポイント: POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
 */
export class ElevenLabsEngine implements TtsEngine {
  readonly engineType = 'elevenlabs' as const
  private readonly apiKey: string
  private readonly voiceId: string
  private readonly modelId: string
  private readonly stability?: number
  private readonly similarityBoost?: number

  constructor(config: ElevenLabsConfig) {
    this.apiKey = config.apiKey
    this.voiceId = config.voiceId
    this.modelId = config.modelId
    this.stability = config.stability
    this.similarityBoost = config.similarityBoost
  }

  async synthesize(
    text: string,
    outputPath: string,
    voice: ElevenLabsVoiceProfile,
    options?: TtsSynthesizeOptions
  ): Promise<string> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('音声合成テキストが空です')
    }

    const voiceId = voice.voiceId ?? this.voiceId
    const baseUrl = options?.endpoint ?? ELEVENLABS_API_BASE
    const endpoint = `${baseUrl}/text-to-speech/${voiceId}`

    const requestBody: Record<string, unknown> = {
      text: normalizedText,
      model_id: voice.modelId ?? this.modelId,
    }

    // voice_settingsは指定されている値のみ含める
    const voiceSettings: Record<string, number> = {}
    const stability = voice.stability ?? this.stability
    const similarityBoost = voice.similarityBoost ?? this.similarityBoost

    if (stability !== undefined) {
      voiceSettings.stability = stability
    }
    if (similarityBoost !== undefined) {
      voiceSettings.similarity_boost = similarityBoost
    }

    if (Object.keys(voiceSettings).length > 0) {
      requestBody.voice_settings = voiceSettings
    }

    logger.debug({ endpoint, voiceId, modelId: requestBody.model_id }, 'ElevenLabs TTS request')

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'xi-api-key': this.apiKey,
        'Content-Type': 'application/json',
        'Accept': 'audio/wav',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      logger.error({ status: response.status, message }, 'ElevenLabs TTS request failed')
      throw new Error(`ElevenLabs TTS に失敗しました (${response.status}): ${message}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(outputPath, buffer)

    return outputPath
  }
}
