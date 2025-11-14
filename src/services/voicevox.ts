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

export interface VoicevoxConfig extends VoicevoxSynthesisParameters {
  endpoint: string
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
  private readonly speakerId: number
  private readonly synthesisOverrides: VoicevoxSynthesisParameters

  constructor(config: VoicevoxConfig) {
    this.endpoint = config.endpoint.replace(/\/+$/, '')
    this.speakerId = config.speakerId
    this.synthesisOverrides = {
      speedScale: config.speedScale,
      pitchScale: config.pitchScale,
      intonationScale: config.intonationScale,
      volumeScale: config.volumeScale,
      outputSamplingRate: config.outputSamplingRate,
      outputStereo: config.outputStereo,
    }
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

    const query = (await queryResponse.json()) as VoicevoxAudioQuery
    const adjustedQuery = this.applySynthesisOverrides(query)
    const synthResponse = await fetch(`${this.endpoint}/synthesis?speaker=${this.speakerId}`, {
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

  private applySynthesisOverrides(query: VoicevoxAudioQuery): VoicevoxAudioQuery {
    const overrides = this.synthesisOverrides
    const adjusted: VoicevoxAudioQuery = { ...query }

    if (overrides.speedScale !== undefined) adjusted.speedScale = overrides.speedScale
    if (overrides.pitchScale !== undefined) adjusted.pitchScale = overrides.pitchScale
    if (overrides.intonationScale !== undefined) adjusted.intonationScale = overrides.intonationScale
    if (overrides.volumeScale !== undefined) adjusted.volumeScale = overrides.volumeScale
    if (overrides.outputSamplingRate !== undefined) adjusted.outputSamplingRate = overrides.outputSamplingRate
    if (overrides.outputStereo !== undefined) adjusted.outputStereo = overrides.outputStereo

    return adjusted
  }
}
