import { promises as fs } from 'node:fs'
import { fetch } from 'undici'

export interface VoicevoxConfig {
  endpoint: string
  speakerId: number
}

export class VoicevoxClient {
  private readonly endpoint: string
  private readonly speakerId: number

  constructor(config: VoicevoxConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, '')
    this.speakerId = config.speakerId
  }

  async synthesize(text: string, outputPath: string): Promise<string> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('音声合成テキストが空です')
    }

    const queryParams = new URLSearchParams({
      text: normalizedText,
      speaker: String(this.speakerId),
    })

    const queryResponse = await fetch(`${this.endpoint}/audio_query?${queryParams.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    if (!queryResponse.ok) {
      const message = await queryResponse.text().catch(() => '')
      throw new Error(`VOICEVOX audio_query に失敗しました (${queryResponse.status}): ${message}`)
    }

    const query = await queryResponse.json()
    const synthResponse = await fetch(`${this.endpoint}/synthesis?speaker=${this.speakerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
    })

    if (!synthResponse.ok) {
      const message = await synthResponse.text().catch(() => '')
      throw new Error(`VOICEVOX synthesis に失敗しました (${synthResponse.status}): ${message}`)
    }

    const buffer = Buffer.from(await synthResponse.arrayBuffer())
    await fs.writeFile(outputPath, buffer)
    return outputPath
  }
}
