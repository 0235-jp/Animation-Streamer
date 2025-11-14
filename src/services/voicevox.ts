import { promises as fs } from 'node:fs'
import { fetch } from 'undici'

export interface VoicevoxSynthesisParameters {
  speedScale?: number
  pitchScale?: number
  intonationScale?: number
  volumeScale?: number
  outputSamplingRate?: number
  outputStereo?: boolean
}

export interface VoicevoxConfig {
  endpoint: string
}

export interface VoicevoxVoiceOptions extends VoicevoxSynthesisParameters {
  speakerId: number
}

type VoicevoxAudioQuery = Record<string, unknown> & {
  speedScale?: number
  pitchScale?: number
  intonationScale?: number
  volumeScale?: number
  outputSamplingRate?: number
  outputStereo?: boolean
}

export class VoicevoxClient {
  private readonly endpoint: string

  constructor(config: VoicevoxConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, '')
  }

  async synthesize(text: string, outputPath: string, voice: VoicevoxVoiceOptions): Promise<string> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('音声合成テキストが空です')
    }

    const queryParams = new URLSearchParams({
      text: normalizedText,
      speaker: String(voice.speakerId),
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

    const query = (await queryResponse.json()) as VoicevoxAudioQuery
    const adjustedQuery = this.applySynthesisOverrides(query, voice)
    const synthResponse = await fetch(`${this.endpoint}/synthesis?speaker=${voice.speakerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adjustedQuery),
    })

    if (!synthResponse.ok) {
      const message = await synthResponse.text().catch(() => '')
      throw new Error(`VOICEVOX synthesis に失敗しました (${synthResponse.status}): ${message}`)
    }

    const buffer = Buffer.from(await synthResponse.arrayBuffer())
    await fs.writeFile(outputPath, buffer)
    return outputPath
  }

  private applySynthesisOverrides(query: VoicevoxAudioQuery, overrides: VoicevoxVoiceOptions): VoicevoxAudioQuery {
    const { speakerId, ...synthesisParams } = overrides
    const definedOverrides = Object.fromEntries(
      Object.entries(synthesisParams).filter(([, value]) => value !== undefined)
    )
    return { ...query, ...definedOverrides }
  }
}
