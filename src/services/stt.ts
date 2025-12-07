import { logger } from '../utils/logger'

export interface STTOptions {
  modelName?: string
  language?: string
}

/**
 * STT (Speech-to-Text) クライアント
 * nodejs-whisper を使用して音声をテキストに変換する
 */
export class STTClient {
  private modelName: string
  private language: string

  constructor(options: STTOptions = {}) {
    this.modelName = options.modelName ?? 'base'
    this.language = options.language ?? 'ja'
  }

  /**
   * 音声ファイルをテキストに変換する
   * @param audioPath 音声ファイルのパス
   * @returns 変換されたテキスト
   */
  async transcribe(audioPath: string): Promise<string> {
    logger.info({ audioPath, modelName: this.modelName }, 'Starting STT transcription')

    try {
      // nodejs-whisper を動的インポート（インストールされていない場合のエラーハンドリング）
      const { nodewhisper } = await import('nodejs-whisper')

      // nodejs-whisper は直接テキストを返す
      const text = await nodewhisper(audioPath, {
        modelName: this.modelName,
        autoDownloadModelName: this.modelName,
        whisperOptions: {
          language: this.language,
          wordTimestamps: false,
        },
      })

      logger.info({ audioPath, textLength: text.length }, 'STT transcription completed')

      return text
    } catch (error) {
      logger.error({ error, audioPath }, 'STT transcription failed')
      throw new Error(
        `音声認識に失敗しました: ${error instanceof Error ? error.message : 'Unknown error'}`
      )
    }
  }
}
