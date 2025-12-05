import { promises as fs } from 'node:fs'
import { fetch } from 'undici'
import type { TtsEngine, TtsSynthesizeOptions, VoicevoxVoiceProfile } from '../types'
import type { TtsEngineType } from '../schema'

type VoicevoxAudioQuery = Record<string, unknown> & {
  speedScale?: number
  pitchScale?: number
  intonationScale?: number
  volumeScale?: number
  outputSamplingRate?: number
  outputStereo?: boolean
}

export interface VoicevoxCompatibleConfig {
  /** エンジンの種類 */
  engineType: 'voicevox' | 'coeiroink' | 'aivis_speech'
  /** エンドポイントURL */
  url: string
}

/**
 * VOICEVOX互換エンジン
 *
 * 以下のエンジンで同じAPIを使用:
 * - VOICEVOX (ポート: 50021)
 * - COEIROINK (ポート: 50032)
 * - AivisSpeech Engine (ポート: 10101)
 */
export class VoicevoxCompatibleEngine implements TtsEngine {
  readonly engineType: TtsEngineType
  private readonly defaultEndpoint: string

  constructor(config: VoicevoxCompatibleConfig) {
    this.engineType = config.engineType
    this.defaultEndpoint = config.url.replace(/\/+$/, '')
  }

  async synthesize(
    text: string,
    outputPath: string,
    voice: VoicevoxVoiceProfile,
    options?: TtsSynthesizeOptions
  ): Promise<string> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('音声合成テキストが空です')
    }

    const endpoint = this.resolveEndpoint(options?.endpoint)

    // Step 1: audio_query でアクセント句を取得
    const queryParams = new URLSearchParams({
      text: normalizedText,
      speaker: String(voice.speakerId),
    })

    const queryResponse = await fetch(`${endpoint}/audio_query?${queryParams.toString()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    })

    if (!queryResponse.ok) {
      const message = await queryResponse.text().catch(() => '')
      throw new Error(`${this.engineType} audio_query に失敗しました (${queryResponse.status}): ${message}`)
    }

    const query = (await queryResponse.json()) as VoicevoxAudioQuery

    // Step 2: パラメータを適用して synthesis で音声生成
    const adjustedQuery = this.applySynthesisOverrides(query, voice)

    const synthResponse = await fetch(`${endpoint}/synthesis?speaker=${voice.speakerId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(adjustedQuery),
    })

    if (!synthResponse.ok) {
      const message = await synthResponse.text().catch(() => '')
      throw new Error(`${this.engineType} synthesis に失敗しました (${synthResponse.status}): ${message}`)
    }

    // Step 3: WAVファイルとして保存
    const buffer = Buffer.from(await synthResponse.arrayBuffer())
    await fs.writeFile(outputPath, buffer)

    return outputPath
  }

  private applySynthesisOverrides(
    query: VoicevoxAudioQuery,
    overrides: VoicevoxVoiceProfile
  ): VoicevoxAudioQuery {
    const { speakerId, emotion, ...synthesisParams } = overrides
    const definedOverrides = Object.fromEntries(
      Object.entries(synthesisParams).filter(([, value]) => value !== undefined)
    )
    return { ...query, ...definedOverrides }
  }

  private resolveEndpoint(override?: string): string {
    const endpoint = override ?? this.defaultEndpoint
    if (!endpoint) {
      throw new Error(`${this.engineType} のエンドポイントが設定されていません`)
    }
    return endpoint.replace(/\/+$/, '')
  }
}
