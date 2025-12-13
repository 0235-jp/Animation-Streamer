import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoistedでモック関数を作成
const { mocks, MockSTTClient } = vi.hoisted(() => {
  const mockTranscribe = vi.fn()

  class STTClientMock {
    constructor() {}
    transcribe = mockTranscribe
  }

  return {
    mocks: {
      transcribe: mockTranscribe,
      synthesize: vi.fn(),
      createJobDir: vi.fn(),
      removeJobDir: vi.fn(),
      normalizeAudio: vi.fn(),
      trimAudioSilence: vi.fn(),
      getAudioDurationMs: vi.fn(),
      fitAudioDuration: vi.fn(),
      createSilentAudio: vi.fn(),
      concatAudioFiles: vi.fn(),
      compose: vi.fn(),
      buildSpeechPlan: vi.fn(),
      fsAccess: vi.fn(),
      fsCopyFile: vi.fn(),
      fsWriteFile: vi.fn(),
      fsMkdir: vi.fn(),
      fsRename: vi.fn(),
    },
    MockSTTClient: STTClientMock,
  }
})

// STTClientをモック
vi.mock('../../src/services/stt', () => ({
  STTClient: MockSTTClient,
}))

// node:fsのpromises APIをモック
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    promises: {
      access: (...args: unknown[]) => mocks.fsAccess(...args),
      copyFile: (...args: unknown[]) => mocks.fsCopyFile(...args),
      writeFile: (...args: unknown[]) => mocks.fsWriteFile(...args),
      mkdir: (...args: unknown[]) => mocks.fsMkdir(...args),
      rename: (...args: unknown[]) => mocks.fsRename(...args),
      rm: vi.fn(),
    },
  }
})

import { GenerationService, ActionProcessingError } from '../../src/services/generation.service'
import type { ResolvedConfig, ResolvedPreset } from '../../src/config/loader'

// テスト用のモック設定を作成
function createMockConfig(withSTT = true): ResolvedConfig {
  return {
    paths: {
      outputDir: '/tmp/output',
      motionDir: '/tmp/motions',
      responsePathBase: undefined,
    },
    presetMap: new Map([
      ['test-preset', createMockPreset()],
    ]),
    stt: withSTT
      ? {
          baseUrl: 'http://localhost:8000/v1',
          apiKey: 'test-key',
          model: 'whisper-1',
          language: 'ja',
        }
      : undefined,
  } as unknown as ResolvedConfig
}

function createMockPreset(): ResolvedPreset {
  return {
    id: 'test-preset',
    audioProfile: {
      ttsEngine: 'voicevox',
      voicevoxUrl: 'http://localhost:50021',
      voices: [{ speakerId: 1, emotion: 'neutral' }],
    },
    actionsMap: new Map(),
    motionGroups: new Map(),
  } as unknown as ResolvedPreset
}

function createMockDeps(config: ResolvedConfig) {
  return {
    config,
    clipPlanner: {
      buildSpeechPlan: mocks.buildSpeechPlan,
      buildIdlePlan: vi.fn(),
      buildActionClip: vi.fn(),
    },
    mediaPipeline: {
      createJobDir: mocks.createJobDir,
      removeJobDir: mocks.removeJobDir,
      normalizeAudio: mocks.normalizeAudio,
      trimAudioSilence: mocks.trimAudioSilence,
      getAudioDurationMs: mocks.getAudioDurationMs,
      fitAudioDuration: mocks.fitAudioDuration,
      createSilentAudio: mocks.createSilentAudio,
      concatAudioFiles: mocks.concatAudioFiles,
      compose: mocks.compose,
    },
    voicevox: {
      synthesize: mocks.synthesize,
    },
    sbv2: {
      synthesize: vi.fn(),
    },
    cacheService: {
      generateCacheKey: vi.fn().mockReturnValue('test-cache-hash'),
      computeFileHash: vi.fn().mockResolvedValue('test-file-hash'),
      computeBufferHash: vi.fn().mockResolvedValue('test-buffer-hash'),
      checkCache: vi.fn().mockResolvedValue(null),
      appendLog: vi.fn().mockResolvedValue(undefined),
      getCachePath: vi.fn().mockReturnValue('/tmp/output/test-cache-hash.mp4'),
      createSpeakLogEntry: vi.fn().mockReturnValue({ file: 'test.mp4', type: 'speak', preset: 'test-preset', createdAt: '2024-01-01T00:00:00Z' }),
      createIdleLogEntry: vi.fn().mockReturnValue({ file: 'test.mp4', type: 'idle', preset: 'test-preset', createdAt: '2024-01-01T00:00:00Z' }),
      createCombinedLogEntry: vi.fn().mockReturnValue({ file: 'test.mp4', type: 'combined', preset: 'test-preset', createdAt: '2024-01-01T00:00:00Z' }),
    },
  }
}

describe('GenerationService - Audio Input', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // デフォルトのモック動作を設定
    mocks.createJobDir.mockResolvedValue('/tmp/job-123')
    mocks.removeJobDir.mockResolvedValue(undefined)
    mocks.normalizeAudio.mockImplementation(
      (inputPath: string) => Promise.resolve(inputPath.replace('.wav', '-normalized.wav'))
    )
    mocks.trimAudioSilence.mockImplementation(
      (inputPath: string) => Promise.resolve(inputPath.replace('.wav', '-trimmed.wav'))
    )
    mocks.getAudioDurationMs.mockResolvedValue(1000)
    mocks.fitAudioDuration.mockImplementation(
      (inputPath: string) => Promise.resolve(inputPath.replace('.wav', '-fit.wav'))
    )
    mocks.createSilentAudio.mockResolvedValue('/tmp/job-123/silence.wav')
    mocks.concatAudioFiles.mockResolvedValue({ outputPath: '/tmp/job-123/concat.wav' })
    mocks.compose.mockResolvedValue({
      outputPath: '/tmp/job-123/output.mp4',
      durationMs: 1000,
    })
    mocks.buildSpeechPlan.mockResolvedValue({
      clips: [],
      motionIds: ['motion-1'],
      totalDurationMs: 1000,
      talkDurationMs: 1000,
    })
    mocks.fsMkdir.mockResolvedValue(undefined)
    mocks.fsRename.mockResolvedValue(undefined)
    mocks.fsAccess.mockResolvedValue(undefined)
    mocks.fsCopyFile.mockResolvedValue(undefined)
    mocks.fsWriteFile.mockResolvedValue(undefined)
    mocks.synthesize.mockResolvedValue(undefined)
  })

  describe('processBatch with audio input', () => {
    it('processes speak action with external audio path', async () => {
      const config = createMockConfig()
      const deps = createMockDeps(config)
      const service = new GenerationService(deps as any)

      const result = await service.processBatch({
        presetId: 'test-preset',
        stream: true,
        requests: [
          {
            action: 'speak',
            params: {
              audio: { path: '/external/audio.wav' },
            },
          },
        ],
      })

      expect(result.kind).toBe('stream')
      expect(mocks.fsAccess).toHaveBeenCalledWith('/external/audio.wav')
      expect(mocks.fsCopyFile).toHaveBeenCalled()
    })

    it('processes speak action with base64 audio', async () => {
      const config = createMockConfig()
      const deps = createMockDeps(config)
      const service = new GenerationService(deps as any)

      const base64Audio = Buffer.from('test audio data').toString('base64')
      const result = await service.processBatch({
        presetId: 'test-preset',
        stream: true,
        requests: [
          {
            action: 'speak',
            params: {
              audio: { base64: base64Audio },
            },
          },
        ],
      })

      expect(result.kind).toBe('stream')
      expect(mocks.fsWriteFile).toHaveBeenCalled()
      const writeCall = mocks.fsWriteFile.mock.calls[0]
      expect(writeCall[0]).toContain('audio-input-')
    })

    it('processes speak action with audio transcription (STT -> TTS)', async () => {
      const config = createMockConfig()
      const deps = createMockDeps(config)
      const service = new GenerationService(deps as any)

      mocks.transcribe.mockResolvedValue('transcribed text')

      const result = await service.processBatch({
        presetId: 'test-preset',
        stream: true,
        requests: [
          {
            action: 'speak',
            params: {
              audio: { path: '/external/audio.wav', transcribe: true },
            },
          },
        ],
      })

      expect(result.kind).toBe('stream')
      expect(mocks.transcribe).toHaveBeenCalled()
      expect(mocks.synthesize).toHaveBeenCalledWith(
        'transcribed text',
        expect.any(String),
        expect.anything(),
        expect.anything()
      )
    })

    it('throws error when STT returns empty text', async () => {
      const config = createMockConfig()
      const deps = createMockDeps(config)
      const service = new GenerationService(deps as any)

      mocks.transcribe.mockResolvedValue('   ')

      await expect(
        service.processBatch({
          presetId: 'test-preset',
          stream: true,
          requests: [
            {
              action: 'speak',
              params: {
                audio: { path: '/external/audio.wav', transcribe: true },
              },
            },
          ],
        })
      ).rejects.toThrow(ActionProcessingError)
    })

    it('throws error when audio file not found', async () => {
      const config = createMockConfig()
      const deps = createMockDeps(config)
      const service = new GenerationService(deps as any)

      mocks.fsAccess.mockRejectedValue(new Error('ENOENT'))

      await expect(
        service.processBatch({
          presetId: 'test-preset',
          stream: true,
          requests: [
            {
              action: 'speak',
              params: {
                audio: { path: '/nonexistent/audio.wav' },
              },
            },
          ],
        })
      ).rejects.toThrow('指定された音声ファイルが見つかりません')
    })

    it('throws error when STT config is not set', async () => {
      const config = createMockConfig(false) // STT無効
      const deps = createMockDeps(config)
      const service = new GenerationService(deps as any)

      await expect(
        service.processBatch({
          presetId: 'test-preset',
          stream: true,
          requests: [
            {
              action: 'speak',
              params: {
                audio: { path: '/external/audio.wav', transcribe: true },
              },
            },
          ],
        })
      ).rejects.toThrow('STT を使用するには設定ファイルの stt セクションを設定してください')
    })

    it('processes text-based speak action as before', async () => {
      const config = createMockConfig()
      const deps = createMockDeps(config)
      const service = new GenerationService(deps as any)

      const result = await service.processBatch({
        presetId: 'test-preset',
        stream: true,
        requests: [
          {
            action: 'speak',
            params: {
              text: 'こんにちは',
            },
          },
        ],
      })

      expect(result.kind).toBe('stream')
      expect(mocks.synthesize).toHaveBeenCalledWith(
        'こんにちは',
        expect.any(String),
        expect.anything(),
        expect.anything()
      )
    })
  })
})
