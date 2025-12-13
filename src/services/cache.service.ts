import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import { logger } from '../utils/logger'

export type SpeakInputType = 'text' | 'audio' | 'audio_transcribe'

export interface SpeakCacheKeyData {
  type: 'speak'
  presetId: string
  inputType: SpeakInputType
  text?: string
  audioHash?: string
  ttsEngine?: string
  ttsSettings?: Record<string, unknown>
  emotion: string
}

export interface IdleCacheKeyData {
  type: 'idle'
  presetId: string
  durationMs: number
  motionId?: string
  emotion: string
}

export interface CombinedCacheKeyData {
  type: 'combined'
  presetId: string
  actionHashes: string[]
}

export type CacheKeyData = SpeakCacheKeyData | IdleCacheKeyData | CombinedCacheKeyData

export interface OutputLogEntry {
  file: string
  type: 'speak' | 'idle' | 'combined'
  preset: string
  inputType?: SpeakInputType
  tts?: string
  speakerId?: number
  emotion?: string
  text?: string
  audioHash?: string
  durationMs?: number
  motionId?: string
  actions?: Array<{ type: string; text?: string; durationMs?: number }>
  createdAt: string
}

export class CacheService {
  private readonly outputDir: string
  private readonly logPath: string

  constructor(outputDir: string) {
    this.outputDir = outputDir
    this.logPath = path.join(outputDir, 'output.jsonl')
  }

  generateCacheKey(data: CacheKeyData): string {
    const json = JSON.stringify(data, Object.keys(data).sort())
    return createHash('sha256').update(json).digest('hex')
  }

  async computeFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash('sha256')
      const stream = createReadStream(filePath)
      stream.on('data', (chunk) => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }

  async computeBufferHash(buffer: Buffer): Promise<string> {
    return createHash('sha256').update(buffer).digest('hex')
  }

  getCachePath(hash: string): string {
    return path.join(this.outputDir, `${hash}.mp4`)
  }

  async checkCache(hash: string): Promise<string | null> {
    const cachePath = this.getCachePath(hash)
    try {
      await fs.access(cachePath)
      logger.info({ hash, cachePath }, 'Cache hit')
      return cachePath
    } catch {
      return null
    }
  }

  async appendLog(entry: OutputLogEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n'
    await fs.appendFile(this.logPath, line, 'utf8')
  }

  async syncLogWithFiles(): Promise<void> {
    try {
      await fs.access(this.logPath)
    } catch {
      logger.info('No output.jsonl found, skipping sync')
      return
    }

    const content = await fs.readFile(this.logPath, 'utf8')
    const lines = content.trim().split('\n').filter(Boolean)
    const validLines: string[] = []

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as OutputLogEntry
        const filePath = path.join(this.outputDir, entry.file)
        try {
          await fs.access(filePath)
          validLines.push(line)
        } catch {
          logger.info({ file: entry.file }, 'Removing log entry for missing file')
        }
      } catch (parseError) {
        logger.warn({ line }, 'Skipping invalid log line')
      }
    }

    await fs.writeFile(this.logPath, validLines.join('\n') + (validLines.length ? '\n' : ''), 'utf8')
    logger.info({ total: lines.length, valid: validLines.length }, 'Log sync completed')
  }

  createSpeakLogEntry(
    fileName: string,
    presetId: string,
    inputType: SpeakInputType,
    options: {
      text?: string
      audioHash?: string
      ttsEngine?: string
      speakerId?: number
      emotion: string
    }
  ): OutputLogEntry {
    const entry: OutputLogEntry = {
      file: fileName,
      type: 'speak',
      preset: presetId,
      inputType,
      emotion: options.emotion,
      createdAt: new Date().toISOString(),
    }

    if (options.text) entry.text = options.text
    if (options.audioHash) entry.audioHash = options.audioHash
    if (options.ttsEngine) entry.tts = options.ttsEngine
    if (options.speakerId !== undefined) entry.speakerId = options.speakerId

    return entry
  }

  createIdleLogEntry(
    fileName: string,
    presetId: string,
    durationMs: number,
    emotion: string,
    motionId?: string
  ): OutputLogEntry {
    const entry: OutputLogEntry = {
      file: fileName,
      type: 'idle',
      preset: presetId,
      durationMs,
      emotion,
      createdAt: new Date().toISOString(),
    }

    if (motionId) entry.motionId = motionId

    return entry
  }

  createCombinedLogEntry(
    fileName: string,
    presetId: string,
    actions: Array<{ type: string; text?: string; durationMs?: number; inputType?: string }>
  ): OutputLogEntry {
    return {
      file: fileName,
      type: 'combined',
      preset: presetId,
      actions,
      createdAt: new Date().toISOString(),
    }
  }
}
