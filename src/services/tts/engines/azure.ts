import { promises as fs } from 'node:fs'
import { fetch } from 'undici'
import type { TtsEngine, TtsSynthesizeOptions, AzureTtsVoiceProfile } from '../types'
import { logger } from '../../../utils/logger'

export interface AzureTtsConfig {
  /** Azure Speech Serviceのサブスクリプションキー（必須） */
  subscriptionKey: string
  /** リージョン（必須）: japaneast, eastus等 */
  region: string
  /** 音声名（必須）: ja-JP-NanamiNeural等 */
  voiceName: string
}

/**
 * Microsoft Azure TTS エンジン
 *
 * エンドポイント: POST https://{region}.tts.speech.microsoft.com/cognitiveservices/v1
 */
export class AzureTtsEngine implements TtsEngine {
  readonly engineType = 'azure' as const
  private readonly subscriptionKey: string
  private readonly region: string
  private readonly voiceName: string

  constructor(config: AzureTtsConfig) {
    this.subscriptionKey = config.subscriptionKey
    this.region = config.region
    this.voiceName = config.voiceName
  }

  async synthesize(
    text: string,
    outputPath: string,
    voice: AzureTtsVoiceProfile,
    options?: TtsSynthesizeOptions
  ): Promise<string> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('音声合成テキストが空です')
    }

    const endpoint =
      options?.endpoint ?? `https://${this.region}.tts.speech.microsoft.com/cognitiveservices/v1`

    const voiceName = voice.voiceName ?? this.voiceName
    const ssml = this.buildSsml(normalizedText, voiceName, voice)

    logger.debug({ endpoint, voiceName }, 'Azure TTS request')

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.subscriptionKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'riff-16khz-16bit-mono-pcm',
        'User-Agent': 'Animation-Streamer',
      },
      body: ssml,
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      logger.error({ status: response.status, message }, 'Azure TTS request failed')
      throw new Error(`Azure TTS に失敗しました (${response.status}): ${message}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(outputPath, buffer)

    return outputPath
  }

  private buildSsml(
    text: string,
    voiceName: string,
    voice: AzureTtsVoiceProfile
  ): string {
    const escapedText = this.escapeXml(text)

    // prosodyの属性は指定されている場合のみ追加
    const prosodyAttrs: string[] = []
    if (voice.speedScale !== undefined) {
      prosodyAttrs.push(`rate="${Math.round(voice.speedScale * 100)}%"`)
    }
    if (voice.pitchScale !== undefined) {
      const sign = voice.pitchScale > 0 ? '+' : ''
      prosodyAttrs.push(`pitch="${sign}${Math.round(voice.pitchScale * 100)}%"`)
    }

    let expressAs = ''
    let expressAsClose = ''
    if (voice.style) {
      const styleDegreeAttr = voice.styleDegree !== undefined ? ` styledegree="${voice.styleDegree}"` : ''
      expressAs = `<mstts:express-as style="${voice.style}"${styleDegreeAttr}>`
      expressAsClose = '</mstts:express-as>'
    }

    const prosodyOpen = prosodyAttrs.length > 0 ? `<prosody ${prosodyAttrs.join(' ')}>` : ''
    const prosodyClose = prosodyAttrs.length > 0 ? '</prosody>' : ''

    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="ja-JP">
  <voice name="${voiceName}">
    ${expressAs}
    ${prosodyOpen}
      ${escapedText}
    ${prosodyClose}
    ${expressAsClose}
  </voice>
</speak>`
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;')
  }
}
