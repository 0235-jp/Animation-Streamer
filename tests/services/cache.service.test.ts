import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { CacheService, type SpeakCacheKeyData, type IdleCacheKeyData, type CombinedCacheKeyData } from '../../src/services/cache.service'

vi.mock('node:fs', () => ({
  promises: {
    access: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    appendFile: vi.fn(),
    rename: vi.fn(),
  },
  createReadStream: vi.fn(),
}))

describe('CacheService', () => {
  let cacheService: CacheService

  beforeEach(() => {
    vi.clearAllMocks()
    cacheService = new CacheService('/tmp/output')
  })

  describe('generateCacheKey', () => {
    it('generates consistent hash for same speak text input', () => {
      const data: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'text',
        text: 'こんにちは',
        ttsEngine: 'voicevox',
        ttsSettings: { speakerId: 1 },
        emotion: 'neutral',
      }

      const hash1 = cacheService.generateCacheKey(data)
      const hash2 = cacheService.generateCacheKey(data)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64) // SHA-256 produces 64 hex characters
    })

    it('generates different hash for different text', () => {
      const data1: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'text',
        text: 'こんにちは',
        emotion: 'neutral',
      }
      const data2: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'text',
        text: 'さようなら',
        emotion: 'neutral',
      }

      const hash1 = cacheService.generateCacheKey(data1)
      const hash2 = cacheService.generateCacheKey(data2)

      expect(hash1).not.toBe(hash2)
    })

    it('generates different hash for different emotion', () => {
      const data1: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'text',
        text: 'こんにちは',
        emotion: 'neutral',
      }
      const data2: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'text',
        text: 'こんにちは',
        emotion: 'happy',
      }

      const hash1 = cacheService.generateCacheKey(data1)
      const hash2 = cacheService.generateCacheKey(data2)

      expect(hash1).not.toBe(hash2)
    })

    it('generates consistent hash for idle action', () => {
      const data: IdleCacheKeyData = {
        type: 'idle',
        presetId: 'anchor-a',
        durationMs: 1000,
        emotion: 'neutral',
      }

      const hash1 = cacheService.generateCacheKey(data)
      const hash2 = cacheService.generateCacheKey(data)

      expect(hash1).toBe(hash2)
    })

    it('generates different hash for idle with different duration', () => {
      const data1: IdleCacheKeyData = {
        type: 'idle',
        presetId: 'anchor-a',
        durationMs: 1000,
        emotion: 'neutral',
      }
      const data2: IdleCacheKeyData = {
        type: 'idle',
        presetId: 'anchor-a',
        durationMs: 2000,
        emotion: 'neutral',
      }

      const hash1 = cacheService.generateCacheKey(data1)
      const hash2 = cacheService.generateCacheKey(data2)

      expect(hash1).not.toBe(hash2)
    })

    it('generates different hash for idle with motionId', () => {
      const data1: IdleCacheKeyData = {
        type: 'idle',
        presetId: 'anchor-a',
        durationMs: 1000,
        emotion: 'neutral',
      }
      const data2: IdleCacheKeyData = {
        type: 'idle',
        presetId: 'anchor-a',
        durationMs: 1000,
        motionId: 'custom-motion',
        emotion: 'neutral',
      }

      const hash1 = cacheService.generateCacheKey(data1)
      const hash2 = cacheService.generateCacheKey(data2)

      expect(hash1).not.toBe(hash2)
    })

    it('generates consistent hash for combined actions', () => {
      const data: CombinedCacheKeyData = {
        type: 'combined',
        presetId: 'anchor-a',
        actionHashes: ['hash1', 'hash2', 'hash3'],
      }

      const hash1 = cacheService.generateCacheKey(data)
      const hash2 = cacheService.generateCacheKey(data)

      expect(hash1).toBe(hash2)
    })

    it('generates different hash for different action order', () => {
      const data1: CombinedCacheKeyData = {
        type: 'combined',
        presetId: 'anchor-a',
        actionHashes: ['hash1', 'hash2'],
      }
      const data2: CombinedCacheKeyData = {
        type: 'combined',
        presetId: 'anchor-a',
        actionHashes: ['hash2', 'hash1'],
      }

      const hash1 = cacheService.generateCacheKey(data1)
      const hash2 = cacheService.generateCacheKey(data2)

      expect(hash1).not.toBe(hash2)
    })

    it('generates different hash for audio input type', () => {
      const data1: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'audio',
        audioHash: 'abc123',
        emotion: 'neutral',
      }
      const data2: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'audio_transcribe',
        audioHash: 'abc123',
        ttsEngine: 'voicevox',
        ttsSettings: { speakerId: 1 },
        emotion: 'neutral',
      }

      const hash1 = cacheService.generateCacheKey(data1)
      const hash2 = cacheService.generateCacheKey(data2)

      expect(hash1).not.toBe(hash2)
    })

    it('generates same hash regardless of nested object key order', () => {
      const data1: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'text',
        text: 'こんにちは',
        ttsEngine: 'voicevox',
        ttsSettings: { speakerId: 1, speedScale: 1.0, pitchScale: 0.0 },
        emotion: 'neutral',
      }
      const data2: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'text',
        text: 'こんにちは',
        ttsEngine: 'voicevox',
        ttsSettings: { pitchScale: 0.0, speakerId: 1, speedScale: 1.0 },
        emotion: 'neutral',
      }

      const hash1 = cacheService.generateCacheKey(data1)
      const hash2 = cacheService.generateCacheKey(data2)

      expect(hash1).toBe(hash2)
    })

    it('generates same hash regardless of top-level key order', () => {
      const data1: SpeakCacheKeyData = {
        type: 'speak',
        presetId: 'anchor-a',
        inputType: 'text',
        text: 'こんにちは',
        emotion: 'neutral',
      }
      // Create object with different key order
      const data2 = {
        emotion: 'neutral',
        text: 'こんにちは',
        inputType: 'text' as const,
        presetId: 'anchor-a',
        type: 'speak' as const,
      }

      const hash1 = cacheService.generateCacheKey(data1)
      const hash2 = cacheService.generateCacheKey(data2)

      expect(hash1).toBe(hash2)
    })
  })

  describe('getCachePath', () => {
    it('returns correct path for hash', () => {
      const hash = 'abc123def456'
      const path = cacheService.getCachePath(hash)

      expect(path).toBe('/tmp/output/abc123def456.mp4')
    })
  })

  describe('checkCache', () => {
    it('returns cache path when file exists', async () => {
      vi.mocked(fs.access).mockResolvedValueOnce(undefined)

      const result = await cacheService.checkCache('existing-hash')

      expect(result).toBe('/tmp/output/existing-hash.mp4')
      expect(fs.access).toHaveBeenCalledWith('/tmp/output/existing-hash.mp4')
    })

    it('returns null when file does not exist', async () => {
      const error = new Error('ENOENT') as NodeJS.ErrnoException
      error.code = 'ENOENT'
      vi.mocked(fs.access).mockRejectedValueOnce(error)

      const result = await cacheService.checkCache('missing-hash')

      expect(result).toBeNull()
    })
  })

  describe('appendLog', () => {
    it('appends JSON line to log file', async () => {
      vi.mocked(fs.appendFile).mockResolvedValueOnce(undefined)

      const entry = {
        file: 'abc123.mp4',
        type: 'speak' as const,
        preset: 'anchor-a',
        text: 'こんにちは',
        createdAt: '2024-01-01T00:00:00Z',
      }

      await cacheService.appendLog(entry)

      expect(fs.appendFile).toHaveBeenCalledWith(
        '/tmp/output/output.jsonl',
        JSON.stringify(entry) + '\n',
        'utf8'
      )
    })
  })

  describe('syncLogWithFiles', () => {
    it('removes entries for missing files', async () => {
      const logContent = [
        '{"file":"exists.mp4","type":"speak","preset":"a","createdAt":"2024-01-01T00:00:00Z"}',
        '{"file":"missing.mp4","type":"speak","preset":"a","createdAt":"2024-01-01T00:00:00Z"}',
        '{"file":"also-exists.mp4","type":"idle","preset":"a","createdAt":"2024-01-01T00:00:00Z"}',
      ].join('\n')

      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // log file exists
        .mockResolvedValueOnce(undefined) // exists.mp4
        .mockRejectedValueOnce(new Error('ENOENT')) // missing.mp4
        .mockResolvedValueOnce(undefined) // also-exists.mp4

      vi.mocked(fs.readFile).mockResolvedValueOnce(logContent)
      vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined)
      vi.mocked(fs.rename).mockResolvedValueOnce(undefined)

      await cacheService.syncLogWithFiles()

      // アトミック書き込み: 一時ファイルに書き込み後リネーム
      expect(fs.writeFile).toHaveBeenCalledWith(
        '/tmp/output/output.jsonl.tmp',
        expect.not.stringContaining('missing.mp4'),
        'utf8'
      )
      expect(fs.rename).toHaveBeenCalledWith(
        '/tmp/output/output.jsonl.tmp',
        '/tmp/output/output.jsonl'
      )
    })

    it('does nothing when log file does not exist', async () => {
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('ENOENT'))

      await cacheService.syncLogWithFiles()

      expect(fs.readFile).not.toHaveBeenCalled()
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it('skips invalid JSON lines', async () => {
      const logContent = [
        '{"file":"valid.mp4","type":"speak","preset":"a","createdAt":"2024-01-01T00:00:00Z"}',
        'invalid json line',
        '{"file":"also-valid.mp4","type":"idle","preset":"a","createdAt":"2024-01-01T00:00:00Z"}',
      ].join('\n')

      vi.mocked(fs.access)
        .mockResolvedValueOnce(undefined) // log file exists
        .mockResolvedValueOnce(undefined) // valid.mp4
        .mockResolvedValueOnce(undefined) // also-valid.mp4

      vi.mocked(fs.readFile).mockResolvedValueOnce(logContent)
      vi.mocked(fs.writeFile).mockResolvedValueOnce(undefined)
      vi.mocked(fs.rename).mockResolvedValueOnce(undefined)

      await cacheService.syncLogWithFiles()

      const writeCall = vi.mocked(fs.writeFile).mock.calls[0]
      expect(writeCall[0]).toBe('/tmp/output/output.jsonl.tmp')
      expect(writeCall[1]).not.toContain('invalid json line')
      expect(writeCall[1]).toContain('valid.mp4')
      expect(writeCall[1]).toContain('also-valid.mp4')
      expect(fs.rename).toHaveBeenCalledWith(
        '/tmp/output/output.jsonl.tmp',
        '/tmp/output/output.jsonl'
      )
    })
  })

  describe('createSpeakLogEntry', () => {
    it('creates entry with text input', () => {
      const entry = cacheService.createSpeakLogEntry('abc.mp4', 'anchor-a', 'text', {
        text: 'Hello',
        emotion: 'neutral',
        ttsEngine: 'voicevox',
        speakerId: 1,
      })

      expect(entry).toMatchObject({
        file: 'abc.mp4',
        type: 'speak',
        preset: 'anchor-a',
        inputType: 'text',
        text: 'Hello',
        emotion: 'neutral',
        tts: 'voicevox',
        speakerId: 1,
      })
      expect(entry.createdAt).toBeDefined()
    })

    it('creates entry with audio input', () => {
      const entry = cacheService.createSpeakLogEntry('def.mp4', 'anchor-b', 'audio', {
        audioHash: 'hash123',
        emotion: 'happy',
      })

      expect(entry).toMatchObject({
        file: 'def.mp4',
        type: 'speak',
        preset: 'anchor-b',
        inputType: 'audio',
        audioHash: 'hash123',
        emotion: 'happy',
      })
      expect(entry.text).toBeUndefined()
    })
  })

  describe('createIdleLogEntry', () => {
    it('creates entry with duration and emotion', () => {
      const entry = cacheService.createIdleLogEntry('idle.mp4', 'anchor-a', 1000, 'neutral')

      expect(entry).toMatchObject({
        file: 'idle.mp4',
        type: 'idle',
        preset: 'anchor-a',
        durationMs: 1000,
        emotion: 'neutral',
      })
      expect(entry.motionId).toBeUndefined()
    })

    it('includes motionId when specified', () => {
      const entry = cacheService.createIdleLogEntry('idle.mp4', 'anchor-a', 500, 'sad', 'custom-motion')

      expect(entry).toMatchObject({
        file: 'idle.mp4',
        type: 'idle',
        preset: 'anchor-a',
        durationMs: 500,
        emotion: 'sad',
        motionId: 'custom-motion',
      })
    })
  })

  describe('createCombinedLogEntry', () => {
    it('creates entry with action details', () => {
      const actions = [
        { type: 'speak', text: 'Hello' },
        { type: 'idle', durationMs: 500 },
      ]

      const entry = cacheService.createCombinedLogEntry('combined.mp4', 'anchor-a', actions)

      expect(entry).toMatchObject({
        file: 'combined.mp4',
        type: 'combined',
        preset: 'anchor-a',
        actions,
      })
      expect(entry.createdAt).toBeDefined()
    })
  })

  describe('computeBufferHash', () => {
    it('generates consistent hash for same buffer', async () => {
      const buffer = Buffer.from('test audio data')

      const hash1 = await cacheService.computeBufferHash(buffer)
      const hash2 = await cacheService.computeBufferHash(buffer)

      expect(hash1).toBe(hash2)
      expect(hash1).toHaveLength(64)
    })

    it('generates different hash for different buffer', async () => {
      const buffer1 = Buffer.from('test audio data 1')
      const buffer2 = Buffer.from('test audio data 2')

      const hash1 = await cacheService.computeBufferHash(buffer1)
      const hash2 = await cacheService.computeBufferHash(buffer2)

      expect(hash1).not.toBe(hash2)
    })
  })
})
