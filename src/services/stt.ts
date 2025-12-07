import fs from 'node:fs'
import OpenAI from 'openai'
import { logger } from '../utils/logger'

export interface STTOptions {
  baseUrl: string
  apiKey?: string
  model?: string
  language?: string
}

/**
 * STT (Speech-to-Text) クライアント
 * OpenAI互換API（faster-whisper-server等）を使用して音声をテキストに変換する
 */
export class STTClient {
  private client: OpenAI
  private model: string
  private language: string

  constructor(options: STTOptions) {
    this.client = new OpenAI({
      baseURL: options.baseUrl,
      apiKey: options.apiKey ?? 'dummy-key', // ローカルサーバーはAPIキー不要の場合が多い
    })
    this.model = options.model ?? 'whisper-1'
    this.language = options.language ?? 'ja'
  }

  /**
   * 音声ファイルをテキストに変換する
   * @param audioPath 音声ファイルのパス
   * @returns 変換されたテキスト
   */
  async transcribe(audioPath: string): Promise<string> {
    logger.info({ audioPath, model: this.model }, 'Starting STT transcription')

    const audioFile = fs.createReadStream(audioPath)
    try {
      const response = await this.client.audio.transcriptions.create({
        file: audioFile,
        model: this.model,
        language: this.language,
      })

      const text = response.text.trim()
      logger.info({ audioPath, textLength: text.length }, 'STT transcription completed')

      return text
    } catch (error) {
      logger.error({ error, audioPath }, 'STT transcription failed')
      if (error instanceof OpenAI.APIError) {
        throw new Error(
          `音声認識に失敗しました: [${error.status}] ${error.name} - ${error.message}`
        )
      }
      throw new Error(
        `音声認識に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    } finally {
      audioFile.destroy()
    }
  }
}
