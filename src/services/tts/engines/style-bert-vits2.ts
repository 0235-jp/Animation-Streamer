import { promises as fs } from 'node:fs'
import { fetch } from 'undici'
import type { TtsEngine, TtsSynthesizeOptions, StyleBertVits2VoiceProfile } from '../types'
import { logger } from '../../../utils/logger'

export interface StyleBertVits2Config {
  /** エンドポイントURL（必須） */
  url: string
  /** モデル名（必須） */
  modelName: string
  /** スタイル（オプション） */
  style?: string
  /** スタイルの強さ（オプション） */
  styleWeight?: number
}

/**
 * Style-Bert-VITS2 エンジン
 *
 * エンドポイント: GET {url}/voice
 */
export class StyleBertVits2Engine implements TtsEngine {
  readonly engineType = 'style_bert_vits2' as const
  private readonly endpoint: string
  private readonly modelName: string
  private readonly style?: string
  private readonly styleWeight?: number

  constructor(config: StyleBertVits2Config) {
    this.endpoint = config.url.replace(/\/+$/, '')
    this.modelName = config.modelName
    this.style = config.style
    this.styleWeight = config.styleWeight
  }

  async synthesize(
    text: string,
    outputPath: string,
    voice: StyleBertVits2VoiceProfile,
    options?: TtsSynthesizeOptions
  ): Promise<string> {
    const normalizedText = text.trim()
    if (!normalizedText) {
      throw new Error('音声合成テキストが空です')
    }

    const endpoint = options?.endpoint ?? this.endpoint
    const modelName = voice.modelName ?? this.modelName

    // Style-Bert-VITS2 API パラメータ
    const params = new URLSearchParams({
      text: normalizedText,
      model_name: modelName,
      language: 'JP',
    })

    // オプションパラメータは指定されている場合のみ追加
    const style = voice.style ?? this.style
    if (style !== undefined) {
      params.set('style', style)
    }

    const styleWeight = voice.styleWeight ?? this.styleWeight
    if (styleWeight !== undefined) {
      params.set('style_weight', String(styleWeight))
    }

    if (voice.speedScale !== undefined) {
      params.set('speed', String(voice.speedScale))
    }

    logger.debug({ endpoint, modelName, style }, 'Style-Bert-VITS2 TTS request')

    const response = await fetch(`${endpoint}/voice?${params.toString()}`, {
      method: 'GET',
    })

    if (!response.ok) {
      const message = await response.text().catch(() => '')
      logger.error({ status: response.status, message }, 'Style-Bert-VITS2 TTS request failed')
      throw new Error(`Style-Bert-VITS2 に失敗しました (${response.status}): ${message}`)
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    await fs.writeFile(outputPath, buffer)

    return outputPath
  }
}
