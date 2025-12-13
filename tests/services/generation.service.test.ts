import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { GenerationService, ActionProcessingError } from '../../src/services/generation.service'
import { NoAudioTrackError } from '../../src/services/media-pipeline'
import type { ClipPlanResult, ClipPlanner } from '../../src/services/clip-planner'
import type { MediaPipeline } from '../../src/services/media-pipeline'
import type { VoicevoxClient } from '../../src/services/voicevox'
import type { StyleBertVits2Client } from '../../src/services/style-bert-vits2'
import type { CacheService } from '../../src/services/cache.service'
import type { ResolvedConfig } from '../../src/config/loader'
import type { ActionResult, GenerateRequestPayload } from '../../src/types/generate'
import { createResolvedConfig } from '../factories/config'

vi.mock('node:crypto', () => ({
  randomUUID: vi.fn(() => 'test-uuid'),
}))

const mockFs = () => {
  vi.spyOn(fs, 'mkdir').mockResolvedValue(undefined)
  vi.spyOn(fs, 'rename').mockResolvedValue()
  vi.spyOn(fs, 'copyFile').mockResolvedValue()
  vi.spyOn(fs, 'rm').mockResolvedValue()
}

const createClipPlan = (overrides?: Partial<ClipPlanResult>): ClipPlanResult => ({
  clips: [
    {
      id: 'clip-1',
      path: '/tmp/clip.mp4',
      durationMs: 1000,
    },
  ],
  totalDurationMs: 1000,
  motionIds: ['clip-1'],
  talkDurationMs: 900,
  ...overrides,
})

const DEFAULT_PRESET_ID = 'anchor-a'

const createService = (configOverride?: ResolvedConfig) => {
  const clipPlanner = {
    buildSpeechPlan: vi.fn().mockResolvedValue(createClipPlan({ talkDurationMs: 900, enterDurationMs: 100, exitDurationMs: 100 })),
    buildIdlePlan: vi.fn().mockResolvedValue(createClipPlan()),
    buildActionClip: vi.fn().mockResolvedValue(createClipPlan({ totalDurationMs: 1500 })),
  }

  const mediaPipeline = {
    createJobDir: vi.fn().mockResolvedValue('/tmp/job'),
    removeJobDir: vi.fn().mockResolvedValue(),
    normalizeAudio: vi.fn().mockResolvedValue('/tmp/normalized.wav'),
    trimAudioSilence: vi.fn().mockResolvedValue('/tmp/trimmed.wav'),
    getAudioDurationMs: vi.fn().mockResolvedValue(1200),
    fitAudioDuration: vi.fn().mockResolvedValue('/tmp/fitted.wav'),
    createSilentAudio: vi.fn().mockResolvedValue('/tmp/silent.wav'),
    concatAudioFiles: vi.fn().mockResolvedValue({ outputPath: '/tmp/concat.wav', durationMs: 1500 }),
    compose: vi.fn().mockResolvedValue({ outputPath: '/tmp/composed.mp4', durationMs: 2000 }),
    createJobDirForAction: vi.fn(),
    concatFiles: vi.fn(),
    extractAudioTrack: vi.fn().mockResolvedValue('/tmp/extracted.wav'),
    getVideoDurationMs: vi.fn().mockResolvedValue(2000),
    normalizeVideo: vi.fn(),
    extractSegment: vi.fn(),
  }

  const voicevox = {
    synthesize: vi.fn().mockResolvedValue('/tmp/voice.wav'),
  }

  const sbv2 = {
    synthesize: vi.fn().mockResolvedValue('/tmp/voice.wav'),
  }

  const cacheService = {
    generateCacheKey: vi.fn().mockReturnValue('test-cache-hash'),
    computeFileHash: vi.fn().mockResolvedValue('test-file-hash'),
    computeBufferHash: vi.fn().mockResolvedValue('test-buffer-hash'),
    checkCache: vi.fn().mockResolvedValue(null),
    appendLog: vi.fn().mockResolvedValue(undefined),
    getCachePath: vi.fn().mockReturnValue('/tmp/output/test-cache-hash.mp4'),
    createSpeakLogEntry: vi.fn().mockReturnValue({ file: 'test.mp4', type: 'speak', preset: 'anchor-a', createdAt: '2024-01-01T00:00:00Z' }),
    createIdleLogEntry: vi.fn().mockReturnValue({ file: 'test.mp4', type: 'idle', preset: 'anchor-a', createdAt: '2024-01-01T00:00:00Z' }),
    createCombinedLogEntry: vi.fn().mockReturnValue({ file: 'test.mp4', type: 'combined', preset: 'anchor-a', createdAt: '2024-01-01T00:00:00Z' }),
  }

  const config = configOverride ?? createResolvedConfig()
  const service = new GenerationService({
    config,
    clipPlanner: clipPlanner as unknown as ClipPlanner,
    mediaPipeline: mediaPipeline as unknown as MediaPipeline,
    voicevox: voicevox as unknown as VoicevoxClient,
    sbv2: sbv2 as unknown as StyleBertVits2Client,
    cacheService: cacheService as unknown as CacheService,
  })

  return { service, clipPlanner, mediaPipeline, voicevox, sbv2, cacheService, config }
}

const withPreset = (
  payload: Omit<GenerateRequestPayload, 'presetId'> & { presetId?: string }
): GenerateRequestPayload => ({
  presetId: payload.presetId ?? DEFAULT_PRESET_ID,
  ...payload,
})

describe('GenerationService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFs()
  })

  it('returns combined batch result for non-stream payloads', async () => {
    const { service, clipPlanner, mediaPipeline, voicevox } = createService()
    const payload = withPreset({
      stream: false,
      requests: [
        { action: 'speak', params: { text: 'こんにちは' } },
        { action: 'idle', params: { durationMs: 500 } },
      ],
    })

    const result = await service.processBatch(payload)

    expect(result.kind).toBe('combined')
    expect(result.result.durationMs).toBeGreaterThan(0)
    expect(result.result.motionIds).toBeUndefined()
    expect(clipPlanner.buildSpeechPlan).toHaveBeenCalledTimes(1)
    expect(clipPlanner.buildIdlePlan).toHaveBeenCalledTimes(1)
    expect(voicevox.synthesize).toHaveBeenCalledWith(
      'こんにちは',
      expect.stringContaining('voice-1.wav'),
      expect.objectContaining({ speakerId: 1 }),
      expect.objectContaining({ endpoint: 'http://127.0.0.1:50021' })
    )
    expect(mediaPipeline.concatAudioFiles).toHaveBeenCalled()
    expect(mediaPipeline.compose).toHaveBeenCalledTimes(1)
  })

  it('selects emotion-specific TTS profile when available', async () => {
    const { service, voicevox } = createService()
    const payload = withPreset({
      stream: false,
      requests: [{ action: 'speak', params: { text: 'やっほー', emotion: 'happy' } }],
    })

    await service.processBatch(payload)

    expect(voicevox.synthesize).toHaveBeenCalledWith(
      'やっほー',
      expect.any(String),
      expect.objectContaining({ speakerId: 2, pitchScale: 0.2 }),
      expect.objectContaining({ endpoint: 'http://127.0.0.1:50021' })
    )
  })

  it('falls back to neutral voice when requested emotion is unavailable', async () => {
    const customConfig = createResolvedConfig()
    customConfig.presets[0].audioProfile = {
      ttsEngine: 'voicevox',
      voicevoxUrl: 'http://127.0.0.1:50021',
      voices: [
        {
          emotion: 'neutral',
          speakerId: 9,
          volumeScale: 0.7,
        },
        {
          emotion: 'sad',
          speakerId: 4,
          speedScale: 0.9,
        },
      ],
    }
    customConfig.presetMap.set(customConfig.presets[0].id, customConfig.presets[0])
    const { service, voicevox } = createService(customConfig)
    const payload = withPreset({
      stream: false,
      requests: [{ action: 'speak', params: { text: 'fallback test', emotion: 'angry' } }],
    })

    await service.processBatch(payload)

    // angryがないのでneutralにフォールバック
    expect(voicevox.synthesize).toHaveBeenCalledWith(
      'fallback test',
      expect.any(String),
      expect.objectContaining({ speakerId: 9, volumeScale: 0.7 }),
      expect.objectContaining({ endpoint: 'http://127.0.0.1:50021' })
    )
  })

  it('throws error when voices is empty for voicevox', async () => {
    const customConfig = createResolvedConfig()
    customConfig.presets[0].audioProfile = {
      ttsEngine: 'voicevox',
      voicevoxUrl: 'http://127.0.0.1:50021',
      voices: [],
    }
    customConfig.presetMap.set(customConfig.presets[0].id, customConfig.presets[0])
    const { service } = createService(customConfig)
    const payload = withPreset({
      stream: false,
      requests: [{ action: 'speak', params: { text: 'error test' } }],
    })

    await expect(service.processBatch(payload)).rejects.toThrow('voicesに少なくとも1つの音声設定が必要です')
  })

  it('includes aggregated motionIds in combined result when debug flag is true', async () => {
    const { service } = createService()
    const payload = withPreset({
      debug: true,
      requests: [
        { action: 'speak', params: { text: 'clip' } },
        { action: 'idle', params: { durationMs: 400 } },
      ],
    })

    const result = await service.processBatch(payload)

    expect(result.kind).toBe('combined')
    expect(result.result.motionIds).toEqual(['clip-1', 'clip-1'])
  })

  it('streams action results when stream=true and invokes handler callbacks', async () => {
    const { service } = createService()
    const handler = { onResult: vi.fn() }
    const payload = withPreset({
      stream: true,
      requests: [{ action: 'idle', params: { durationMs: 400 } }],
    })

    const result = (await service.processBatch(payload, handler)) as { kind: 'stream'; results: ActionResult[] }

    expect(result.kind).toBe('stream')
    expect(result.results).toHaveLength(1)
    expect(handler.onResult).toHaveBeenCalledTimes(1)
    expect(result.results[0]).toMatchObject({ action: 'idle' })
    expect(result.results[0].motionIds).toBeUndefined()
  })

  it('exposes motionIds for streaming results when debug flag is true', async () => {
    const { service } = createService()
    const payload = withPreset({
      stream: true,
      debug: true,
      requests: [{ action: 'idle', params: { durationMs: 400 } }],
    })

    const result = (await service.processBatch(payload)) as { kind: 'stream'; results: ActionResult[] }

    expect(result.results[0].motionIds).toEqual(['clip-1'])
  })

  it('rewrites output paths when responsePathBase is configured', async () => {
    const customConfig = createResolvedConfig({
      paths: {
        projectRoot: '/app',
        motionsDir: '/app/motions',
        outputDir: '/app/output',
        responsePathBase: '/host/output',
      },
    })
    customConfig.presetMap.set(customConfig.presets[0].id, customConfig.presets[0])
    const { service } = createService(customConfig)
    const payload = withPreset({
      stream: false,
      requests: [{ action: 'idle', params: { durationMs: 400 } }],
    })

    const result = await service.processBatch(payload)

    expect(result.kind).toBe('combined')
    // cache未指定（デフォルトfalse）の場合、ファイル名はハッシュ+UUID
    expect(result.result.outputPath).toBe(path.join('/host/output', 'test-cache-hash-test-uuid.mp4'))
  })

  it('pads speech audio with silent segments when transitions are present', async () => {
    const { service, mediaPipeline } = createService()
    const payload = withPreset({
      requests: [{ action: 'speak', params: { text: 'transition test' } }],
    })

    await service.processBatch(payload)

    expect(mediaPipeline.createSilentAudio).toHaveBeenCalledTimes(2)
    expect(mediaPipeline.createSilentAudio).toHaveBeenNthCalledWith(1, 100, '/tmp/job')
    expect(mediaPipeline.createSilentAudio).toHaveBeenNthCalledWith(2, 100, '/tmp/job')
    expect(mediaPipeline.concatAudioFiles).toHaveBeenCalledWith(expect.any(Array), '/tmp/job')
  })

  it('trims normalized audio before measuring duration and fitting talk segments', async () => {
    const { service, mediaPipeline } = createService()
    const payload = withPreset({
      requests: [{ action: 'speak', params: { text: 'trim me' } }],
    })

    mediaPipeline.getAudioDurationMs.mockResolvedValueOnce(1100)

    await service.processBatch(payload)

    expect(mediaPipeline.trimAudioSilence).toHaveBeenCalledWith('/tmp/normalized.wav', '/tmp/job', expect.stringContaining('voice-1-trim'))
    expect(mediaPipeline.getAudioDurationMs).toHaveBeenCalledWith('/tmp/trimmed.wav')
    expect(mediaPipeline.fitAudioDuration).toHaveBeenCalledWith(
      '/tmp/trimmed.wav',
      expect.any(Number),
      '/tmp/job',
      expect.stringContaining('voice-1-fit')
    )
  })

  it('wraps unexpected errors in streaming mode as ActionProcessingError(500)', async () => {
    const { service, voicevox } = createService()
    voicevox.synthesize.mockRejectedValue(new Error('VOICEVOX failure'))

    const payload = withPreset({
      stream: true,
      requests: [{ action: 'speak', params: { text: 'error' } }],
    })

    await expect(service.processBatch(payload)).rejects.toMatchObject({
      message: 'VOICEVOX failure',
      statusCode: 500,
      requestId: '1',
    })
  })

  it('ensures job directory cleanup when planning fails in combined mode', async () => {
    const { service, clipPlanner, mediaPipeline } = createService()
    clipPlanner.buildSpeechPlan.mockRejectedValue(new Error('bad plan'))

    const payload = withPreset({
      requests: [{ action: 'speak', params: { text: 'hello' } }],
    })

    await expect(service.processBatch(payload)).rejects.toBeInstanceOf(ActionProcessingError)
    expect(mediaPipeline.removeJobDir).toHaveBeenCalledWith('/tmp/job')
  })

  it('throws ActionProcessingError for undefined custom actions', async () => {
    const { service } = createService()
    const payload = withPreset({
      requests: [{ action: 'wave' }],
    })

    await expect(service.processBatch(payload)).rejects.toMatchObject({
      message: expect.stringContaining('presetId=anchor-a'),
      statusCode: 400,
    })
  })

  it('creates silent audio when a custom action video lacks an audio track', async () => {
    const { service, mediaPipeline } = createService()
    mediaPipeline.extractAudioTrack.mockRejectedValue(new NoAudioTrackError('/tmp/action.mp4'))

    const payload = withPreset({
      requests: [{ action: 'start' }],
    })

    const result = await service.processBatch(payload)

    expect(result.kind).toBe('combined')
    expect(mediaPipeline.createSilentAudio).toHaveBeenCalled()
  })

  it('validates speak params and surfaces ActionProcessingError when text is missing', async () => {
    const { service } = createService()
    const payload = withPreset({
      stream: false,
      requests: [{ action: 'speak', params: {} }],
    })

    await expect(service.processBatch(payload)).rejects.toMatchObject({
      message: expect.stringContaining('text は必須です'),
      statusCode: 400,
    })
  })

  it('validates idle params and rejects non-positive duration', async () => {
    const { service } = createService()
    const payload = withPreset({
      requests: [{ action: 'idle', params: { durationMs: 0 } }],
    })

    await expect(service.processBatch(payload)).rejects.toMatchObject({
      message: expect.stringContaining('durationMs は正の数値で指定してください'),
      statusCode: 400,
    })
  })

  it('uses undefined motionId when params omit motionId', async () => {
    const { service, clipPlanner } = createService()
    const payload = withPreset({
      requests: [{ action: 'idle', params: { durationMs: 700 } }],
    })

    await service.processBatch(payload)

    expect(clipPlanner.buildIdlePlan).toHaveBeenCalledWith(DEFAULT_PRESET_ID, expect.any(Number), undefined, undefined)
  })

  it('uses neutral emotion for speak actions when params omit emotion', async () => {
    const { service, clipPlanner } = createService()
    const payload = withPreset({
      requests: [{ action: 'speak', params: { text: 'default emotion' } }],
    })

    await service.processBatch(payload)

    expect(clipPlanner.buildSpeechPlan).toHaveBeenCalledWith(DEFAULT_PRESET_ID, 'neutral', expect.any(Number))
  })

  it('assigns sequential string ids to streaming results', async () => {
    const { service } = createService()
    const payload = withPreset({
      stream: true,
      requests: [
        { action: 'idle', params: { durationMs: 300 } },
        { action: 'idle', params: { durationMs: 400 } },
      ],
    })

    const result = (await service.processBatch(payload)) as { kind: 'stream'; results: ActionResult[] }

    expect(result.kind).toBe('stream')
    expect(result.results.map((r) => r.id)).toEqual(['1', '2'])
  })

  it('prevents registering reserved action ids for custom actions', async () => {
    const { service } = createService()
    const preset = (service as any).config.presets[0]
    await expect((service as any).buildCustomActionPlanData(preset, { action: 'speak' }, '1')).rejects.toThrow('予約語')
  })

  describe('forStreamPipeline', () => {
    it('outputs to output/stream and returns actual path when forStreamPipeline is true', async () => {
      const customConfig = createResolvedConfig({
        paths: {
          projectRoot: '/app',
          motionsDir: '/app/motions',
          outputDir: '/app/output',
          responsePathBase: '/host/output',
        },
      })
      customConfig.presetMap.set(customConfig.presets[0].id, customConfig.presets[0])
      const { service } = createService(customConfig)
      const payload = withPreset({
        stream: true,
        forStreamPipeline: true,
        requests: [{ action: 'idle', params: { durationMs: 400 } }],
      })

      const result = (await service.processBatch(payload)) as { kind: 'stream'; results: ActionResult[] }

      expect(result.kind).toBe('stream')
      // forStreamPipeline=trueの場合、output/streamに出力し、実パスを返す
      expect(result.results[0].outputPath).toBe(path.join('/app/output/stream', 'idle-1-test-uuid.mp4'))
    })

    it('outputs to output and returns response path when forStreamPipeline is false', async () => {
      const customConfig = createResolvedConfig({
        paths: {
          projectRoot: '/app',
          motionsDir: '/app/motions',
          outputDir: '/app/output',
          responsePathBase: '/host/output',
        },
      })
      customConfig.presetMap.set(customConfig.presets[0].id, customConfig.presets[0])
      const { service } = createService(customConfig)
      const payload = withPreset({
        stream: true,
        forStreamPipeline: false,
        requests: [{ action: 'idle', params: { durationMs: 400 } }],
      })

      const result = (await service.processBatch(payload)) as { kind: 'stream'; results: ActionResult[] }

      expect(result.kind).toBe('stream')
      // forStreamPipeline=falseの場合、outputに出力し、responsePathBaseで変換されたパスを返す
      // cache未指定（デフォルトfalse）の場合、ファイル名はハッシュ+UUID
      expect(result.results[0].outputPath).toBe(path.join('/host/output', 'test-cache-hash-test-uuid.mp4'))
    })

    it('defaults forStreamPipeline to false when not specified', async () => {
      const customConfig = createResolvedConfig({
        paths: {
          projectRoot: '/app',
          motionsDir: '/app/motions',
          outputDir: '/app/output',
          responsePathBase: '/host/output',
        },
      })
      customConfig.presetMap.set(customConfig.presets[0].id, customConfig.presets[0])
      const { service } = createService(customConfig)
      const payload = withPreset({
        stream: true,
        // forStreamPipelineは未指定
        requests: [{ action: 'idle', params: { durationMs: 400 } }],
      })

      const result = (await service.processBatch(payload)) as { kind: 'stream'; results: ActionResult[] }

      expect(result.kind).toBe('stream')
      // デフォルトはfalseなのでresponsePathBaseで変換されたパスを返す
      // cache未指定（デフォルトfalse）の場合、ファイル名はハッシュ+UUID
      expect(result.results[0].outputPath).toBe(path.join('/host/output', 'test-cache-hash-test-uuid.mp4'))
    })
  })

  it('builds combined timeline preserving clip order and total duration', async () => {
    const { service, clipPlanner, mediaPipeline } = createService()
    const speakClip = { id: 'speak-clip', path: '/tmp/speak.mp4', durationMs: 900 }
    const idleClip = { id: 'idle-clip', path: '/tmp/idle.mp4', durationMs: 400 }
    const customClip = { id: 'custom-clip', path: '/tmp/custom.mp4', durationMs: 700 }

    clipPlanner.buildSpeechPlan.mockResolvedValueOnce(
      createClipPlan({
        clips: [speakClip],
        motionIds: ['speak-clip'],
        totalDurationMs: 900,
        talkDurationMs: 900,
      })
    )
    clipPlanner.buildIdlePlan.mockResolvedValueOnce(
      createClipPlan({
        clips: [idleClip],
        motionIds: ['idle-clip'],
        totalDurationMs: 400,
      })
    )
    clipPlanner.buildActionClip.mockResolvedValueOnce(
      createClipPlan({
        clips: [customClip],
        motionIds: ['custom-clip'],
        totalDurationMs: 700,
      })
    )

    const payload = withPreset({
      requests: [
        { action: 'speak', params: { text: 'hello' } },
        { action: 'idle', params: { durationMs: 300 } },
        { action: 'start' },
      ],
    })

    await service.processBatch(payload)

    expect(mediaPipeline.concatAudioFiles).toHaveBeenCalledWith(expect.any(Array), '/tmp/job')
    expect(mediaPipeline.compose).toHaveBeenCalledWith({
      clips: [speakClip, idleClip, customClip],
      audioPath: expect.any(String),
      durationMs: 2000,
      jobDir: '/tmp/job',
    })
  })

  describe('cache functionality', () => {
    it('returns cached file when cache=true and cache exists for speak action', async () => {
      const { service, cacheService, mediaPipeline, voicevox } = createService()
      cacheService.checkCache.mockResolvedValueOnce('/tmp/output/cached-hash.mp4')
      mediaPipeline.getVideoDurationMs.mockResolvedValueOnce(1500)

      const payload = withPreset({
        stream: true,
        cache: true,
        requests: [{ action: 'speak', params: { text: 'cached text' } }],
      })

      const result = (await service.processBatch(payload)) as { kind: 'stream'; results: ActionResult[] }

      expect(result.kind).toBe('stream')
      expect(result.results[0].outputPath).toBe('/tmp/output/cached-hash.mp4')
      expect(result.results[0].durationMs).toBe(1500)
      expect(voicevox.synthesize).not.toHaveBeenCalled()
      expect(mediaPipeline.compose).not.toHaveBeenCalled()
    })

    it('returns cached file when cache=true and cache exists for idle action', async () => {
      const { service, cacheService, mediaPipeline, clipPlanner } = createService()
      cacheService.checkCache.mockResolvedValueOnce('/tmp/output/cached-idle.mp4')
      mediaPipeline.getVideoDurationMs.mockResolvedValueOnce(500)

      const payload = withPreset({
        stream: true,
        cache: true,
        requests: [{ action: 'idle', params: { durationMs: 500 } }],
      })

      const result = (await service.processBatch(payload)) as { kind: 'stream'; results: ActionResult[] }

      expect(result.kind).toBe('stream')
      expect(result.results[0].outputPath).toBe('/tmp/output/cached-idle.mp4')
      expect(result.results[0].durationMs).toBe(500)
      expect(clipPlanner.buildIdlePlan).not.toHaveBeenCalled()
      expect(mediaPipeline.compose).not.toHaveBeenCalled()
    })

    it('generates new file when cache=true but cache miss for speak action', async () => {
      const { service, cacheService, voicevox, mediaPipeline } = createService()
      cacheService.checkCache.mockResolvedValue(null)

      const payload = withPreset({
        stream: true,
        cache: true,
        requests: [{ action: 'speak', params: { text: 'new text' } }],
      })

      const result = (await service.processBatch(payload)) as { kind: 'stream'; results: ActionResult[] }

      expect(result.kind).toBe('stream')
      expect(cacheService.checkCache).toHaveBeenCalled()
      expect(voicevox.synthesize).toHaveBeenCalled()
      expect(mediaPipeline.compose).toHaveBeenCalled()
      expect(cacheService.appendLog).toHaveBeenCalled()
    })

    it('skips cache check when cache=false', async () => {
      const { service, cacheService, voicevox } = createService()

      const payload = withPreset({
        stream: true,
        cache: false,
        requests: [{ action: 'speak', params: { text: 'no cache' } }],
      })

      await service.processBatch(payload)

      expect(cacheService.checkCache).not.toHaveBeenCalled()
      expect(voicevox.synthesize).toHaveBeenCalled()
      expect(cacheService.appendLog).toHaveBeenCalled()
    })

    it('skips cache check when cache is not specified', async () => {
      const { service, cacheService, voicevox } = createService()

      const payload = withPreset({
        stream: true,
        requests: [{ action: 'speak', params: { text: 'default' } }],
      })

      await service.processBatch(payload)

      expect(cacheService.checkCache).not.toHaveBeenCalled()
      expect(voicevox.synthesize).toHaveBeenCalled()
    })

    it('always appends to log regardless of cache flag', async () => {
      const { service, cacheService } = createService()

      const payload = withPreset({
        stream: true,
        cache: false,
        requests: [{ action: 'speak', params: { text: 'log test' } }],
      })

      await service.processBatch(payload)

      expect(cacheService.appendLog).toHaveBeenCalled()
    })

    it('uses UUID filename and skips cache for forStreamPipeline=true', async () => {
      const { service, cacheService, mediaPipeline } = createService()

      const payload = withPreset({
        stream: true,
        forStreamPipeline: true,
        cache: true,
        requests: [{ action: 'speak', params: { text: 'stream pipeline' } }],
      })

      const result = (await service.processBatch(payload)) as { kind: 'stream'; results: ActionResult[] }

      expect(cacheService.checkCache).not.toHaveBeenCalled()
      expect(cacheService.appendLog).not.toHaveBeenCalled()
      expect(result.results[0].outputPath).toContain('speak-1-test-uuid.mp4')
    })

    it('generates cache key with text for text input', async () => {
      const { service, cacheService } = createService()

      const payload = withPreset({
        stream: true,
        requests: [{ action: 'speak', params: { text: 'hello world' } }],
      })

      await service.processBatch(payload)

      expect(cacheService.generateCacheKey).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'speak',
          inputType: 'text',
          text: 'hello world',
        })
      )
    })

    it('includes emotion in cache key', async () => {
      const { service, cacheService } = createService()

      const payload = withPreset({
        stream: true,
        requests: [{ action: 'speak', params: { text: 'emotional', emotion: 'happy' } }],
      })

      await service.processBatch(payload)

      expect(cacheService.generateCacheKey).toHaveBeenCalledWith(
        expect.objectContaining({
          emotion: 'happy',
        })
      )
    })

    it('includes motionId in idle cache key when specified', async () => {
      const { service, cacheService } = createService()

      const payload = withPreset({
        stream: true,
        requests: [{ action: 'idle', params: { durationMs: 1000, motionId: 'custom-motion' } }],
      })

      await service.processBatch(payload)

      expect(cacheService.generateCacheKey).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'idle',
          durationMs: 1000,
          motionId: 'custom-motion',
        })
      )
    })

    it('returns cached combined result when cache=true and all actions are cached', async () => {
      const { service, cacheService, mediaPipeline } = createService()
      cacheService.checkCache.mockResolvedValueOnce('/tmp/output/combined-cached.mp4')
      mediaPipeline.getVideoDurationMs.mockResolvedValueOnce(3000)

      const payload = withPreset({
        stream: false,
        cache: true,
        requests: [
          { action: 'speak', params: { text: 'combined' } },
          { action: 'idle', params: { durationMs: 500 } },
        ],
      })

      const result = await service.processBatch(payload)

      expect(result.kind).toBe('combined')
      expect(result.result.outputPath).toContain('combined-cached.mp4')
      expect(result.result.durationMs).toBe(3000)
    })

    it('creates speak log entry with correct inputType for text', async () => {
      const { service, cacheService } = createService()

      const payload = withPreset({
        stream: true,
        requests: [{ action: 'speak', params: { text: 'log entry test' } }],
      })

      await service.processBatch(payload)

      expect(cacheService.createSpeakLogEntry).toHaveBeenCalledWith(
        expect.stringContaining('.mp4'),
        DEFAULT_PRESET_ID,
        'text',
        expect.objectContaining({
          text: 'log entry test',
          emotion: 'neutral',
        })
      )
    })

    it('creates idle log entry with duration and emotion', async () => {
      const { service, cacheService } = createService()

      const payload = withPreset({
        stream: true,
        requests: [{ action: 'idle', params: { durationMs: 800, emotion: 'sad' } }],
      })

      await service.processBatch(payload)

      expect(cacheService.createIdleLogEntry).toHaveBeenCalledWith(
        expect.stringContaining('.mp4'),
        DEFAULT_PRESET_ID,
        800,
        'sad',
        undefined
      )
    })

    it('creates combined log entry with action details', async () => {
      const { service, cacheService } = createService()
      cacheService.checkCache.mockResolvedValue(null)

      const payload = withPreset({
        stream: false,
        requests: [
          { action: 'speak', params: { text: 'first' } },
          { action: 'idle', params: { durationMs: 300 } },
        ],
      })

      await service.processBatch(payload)

      expect(cacheService.createCombinedLogEntry).toHaveBeenCalledWith(
        expect.stringContaining('.mp4'),
        DEFAULT_PRESET_ID,
        expect.arrayContaining([
          expect.objectContaining({ type: 'speak' }),
          expect.objectContaining({ type: 'idle', durationMs: expect.any(Number) }),
        ])
      )
    })
  })
})
