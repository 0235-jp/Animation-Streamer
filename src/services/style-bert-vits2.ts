import { promises as fs } from 'node:fs'
import { fetch } from 'undici'

export interface StyleBertVits2SynthesisParameters {
  sdpRatio?: number
  noise?: number
  noisew?: number
  length?: number
  language?: string
  style?: string
  styleWeight?: number
  assistText?: string
  assistTextWeight?: number
  autoSplit?: boolean
  splitInterval?: number
  referenceAudioPath?: string
}

export interface StyleBertVits2Config {
  endpoint?: string
}

export interface StyleBertVits2VoiceOptions extends StyleBertVits2SynthesisParameters {
  modelId?: number
  modelName?: string
  speakerId?: number
  speakerName?: string
}

export interface StyleBertVits2SynthesizeOptions {
  endpoint?: string
}

export class StyleBertVits2Client {
  private readonly defaultEndpoint?: string

  constructor(config: StyleBertVits2Config = {}) {
    this.defaultEndpoint = config.endpoint?.replace(/\/+$/, '')
  }

  async synthesize(
    text: string,
    outputPath: string,
    voice: StyleBertVits2VoiceOptions,
    options?: StyleBertVits2SynthesizeOptions
  ): Promise<string> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('音声合成テキストが空です')
    }
    const endpoint = this.resolveEndpoint(options?.endpoint)

    const queryParams = new URLSearchParams()
    queryParams.set('text', normalizedText)

    // モデル指定
    if (voice.modelId !== undefined) {
      queryParams.set('model_id', String(voice.modelId))
    }
    if (voice.modelName) {
      queryParams.set('model_name', voice.modelName)
    }

    // スピーカー指定
    if (voice.speakerId !== undefined) {
      queryParams.set('speaker_id', String(voice.speakerId))
    }
    if (voice.speakerName) {
      queryParams.set('speaker_name', voice.speakerName)
    }

    // 音声制御パラメータ
    if (voice.sdpRatio !== undefined) {
      queryParams.set('sdp_ratio', String(voice.sdpRatio))
    }
    if (voice.noise !== undefined) {
      queryParams.set('noise', String(voice.noise))
    }
    if (voice.noisew !== undefined) {
      queryParams.set('noisew', String(voice.noisew))
    }
    if (voice.length !== undefined) {
      queryParams.set('length', String(voice.length))
    }
    if (voice.language) {
      queryParams.set('language', voice.language)
    }

    // スタイル関連パラメータ
    if (voice.style) {
      queryParams.set('style', voice.style)
    }
    if (voice.styleWeight !== undefined) {
      queryParams.set('style_weight', String(voice.styleWeight))
    }
    if (voice.assistText) {
      queryParams.set('assist_text', voice.assistText)
    }
    if (voice.assistTextWeight !== undefined) {
      queryParams.set('assist_text_weight', String(voice.assistTextWeight))
    }

    // その他のパラメータ
    if (voice.autoSplit !== undefined) {
      queryParams.set('auto_split', String(voice.autoSplit))
    }
    if (voice.splitInterval !== undefined) {
      queryParams.set('split_interval', String(voice.splitInterval))
    }
    if (voice.referenceAudioPath) {
      queryParams.set('reference_audio_path', voice.referenceAudioPath)
    }

    const response = await fetch(`${endpoint}/voice?${queryParams.toString()}`, {
      method: 'GET',
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      throw new Error(`Style-Bert-VITS2 音声合成に失敗しました (${response.status}): ${message}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(outputPath, buffer)
    return outputPath
  }

  private resolveEndpoint(override?: string): string {
    const endpoint = override ?? this.defaultEndpoint
    if (!endpoint) {
      throw new Error('Style-Bert-VITS2 endpoint が設定されていません')
    }
    return endpoint.replace(/\/+$/, '')
  }
}
