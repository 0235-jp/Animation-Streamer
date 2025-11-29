import { promises as fs } from 'node:fs'
import { fetch } from 'undici'
import type { TtsEngine, TtsSynthesizeOptions, GoogleTtsVoiceProfile } from '../types'
import { logger } from '../../../utils/logger'

const GOOGLE_TTS_ENDPOINT = 'https://texttospeech.googleapis.com/v1/text:synthesize'

export interface GoogleTtsConfig {
  /** Google Cloud APIキー（必須） */
  apiKey: string
  /** 言語コード（必須）: ja-JP, en-US等 */
  languageCode: string
  /** 音声名（必須）: ja-JP-Wavenet-A等 */
  voiceName: string
}

/**
 * Google Cloud Text-to-Speech エンジン
 *
 * エンドポイント: POST https://texttospeech.googleapis.com/v1/text:synthesize
 */
export class GoogleTtsEngine implements TtsEngine {
  readonly engineType = 'google' as const
  private readonly apiKey: string
  private readonly languageCode: string
  private readonly voiceName: string

  constructor(config: GoogleTtsConfig) {
    this.apiKey = config.apiKey
    this.languageCode = config.languageCode
    this.voiceName = config.voiceName
  }

  async synthesize(
    text: string,
    outputPath: string,
    voice: GoogleTtsVoiceProfile,
    options?: TtsSynthesizeOptions
  ): Promise<string> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('音声合成テキストが空です')
    }

    const endpoint = options?.endpoint ?? GOOGLE_TTS_ENDPOINT

    const audioConfig: Record<string, unknown> = {
      audioEncoding: 'LINEAR16', // WAV format
    }

    // 指定されている値のみ追加
    if (voice.speedScale !== undefined) {
      audioConfig.speakingRate = voice.speedScale
    }
    if (voice.pitchScale !== undefined) {
      audioConfig.pitch = voice.pitchScale
    }
    if (voice.volumeScale !== undefined) {
      audioConfig.volumeGainDb = (voice.volumeScale - 1.0) * 6.0 // 1.0 = 0dB
    }

    const requestBody = {
      input: {
        text: normalizedText,
      },
      voice: {
        languageCode: voice.languageCode ?? this.languageCode,
        name: voice.voiceName ?? this.voiceName,
      },
      audioConfig,
    }

    logger.debug({ endpoint, languageCode: requestBody.voice.languageCode, voiceName: requestBody.voice.name }, 'Google TTS request')

    const response = await fetch(`${endpoint}?key=${this.apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      logger.error({ status: response.status, message }, 'Google TTS request failed')
      throw new Error(`Google Cloud TTS に失敗しました (${response.status}): ${message}`)
    }

    const result = (await response.json()) as { audioContent: string }

    // Base64デコードしてファイルに書き込み
    const buffer = Buffer.from(result.audioContent, 'base64')
    await fs.writeFile(outputPath, buffer)

    return outputPath
  }
}
