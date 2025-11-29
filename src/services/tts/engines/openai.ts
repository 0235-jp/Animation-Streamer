import { promises as fs } from 'node:fs'
import { fetch } from 'undici'
import type { TtsEngine, TtsSynthesizeOptions, OpenAiVoiceProfile } from '../types'
import { logger } from '../../../utils/logger'

const OPENAI_TTS_ENDPOINT = 'https://api.openai.com/v1/audio/speech'

export interface OpenAiTtsConfig {
  /** OpenAI APIキー（必須） */
  apiKey: string
  /** 音声名（必須）: alloy, echo, fable, onyx, nova, shimmer */
  voice: string
  /** モデル（必須）: tts-1, tts-1-hd */
  model: string
}

/**
 * OpenAI TTS エンジン
 *
 * エンドポイント: POST https://api.openai.com/v1/audio/speech
 */
export class OpenAiTtsEngine implements TtsEngine {
  readonly engineType = 'openai' as const
  private readonly apiKey: string
  private readonly voice: string
  private readonly model: string

  constructor(config: OpenAiTtsConfig) {
    this.apiKey = config.apiKey
    this.voice = config.voice
    this.model = config.model
  }

  async synthesize(
    text: string,
    outputPath: string,
    voice: OpenAiVoiceProfile,
    options?: TtsSynthesizeOptions
  ): Promise<string> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('音声合成テキストが空です')
    }

    const endpoint = options?.endpoint ?? OPENAI_TTS_ENDPOINT

    const requestBody: Record<string, unknown> = {
      model: voice.model ?? this.model,
      input: normalizedText,
      voice: voice.voice ?? this.voice,
      response_format: 'wav',
    }

    // speedScaleが指定されている場合のみ追加
    if (voice.speedScale !== undefined) {
      requestBody.speed = voice.speedScale
    }

    logger.debug({ endpoint, voice: requestBody.voice, model: requestBody.model }, 'OpenAI TTS request')

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      logger.error({ status: response.status, message }, 'OpenAI TTS request failed')
      throw new Error(`OpenAI TTS に失敗しました (${response.status}): ${message}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(outputPath, buffer)

    return outputPath
  }
}
