import { describe, it, expect, beforeEach, vi, type MockedFunction } from 'vitest'
import { StreamService, type StreamPhase } from '../../src/services/stream.service'
import type { ResolvedConfig } from '../../src/config/loader'
import type { ClipPlanner } from '../../src/services/clip-planner'
import type { MediaPipeline } from '../../src/services/media-pipeline'
import type { GenerationService } from '../../src/services/generation.service'
import type { GenerateRequestPayload } from '../../src/types/generate'
import { createResolvedConfig } from '../factories/config'

vi.mock('crypto', () => ({
  randomUUID: vi.fn(() => 'test-session-uuid'),
}))

const mockIdleLoopController = {
  start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined),
  insertTask: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../src/services/idle-loop.controller', () => ({
  IdleLoopController: vi.fn(() => mockIdleLoopController),
}))

const DEFAULT_PRESET_ID = 'anchor-a'

const createService = (configOverride?: ResolvedConfig) => {
  const config = configOverride ?? createResolvedConfig()

  const clipPlanner = {} as ClipPlanner

  const mediaPipeline = {} as MediaPipeline

  const generationService = {
    processBatch: vi.fn().mockResolvedValue({
      kind: 'stream',
      results: [
        { id: '1', action: 'speak', outputPath: '/output/stream/speak-1.mp4', durationMs: 1000 },
      ],
    }),
  } as unknown as GenerationService

  const service = new StreamService(config, clipPlanner, mediaPipeline, generationService)

  return { service, config, generationService }
}

describe('StreamService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockIdleLoopController.start.mockResolvedValue(undefined)
    mockIdleLoopController.stop.mockResolvedValue(undefined)
    mockIdleLoopController.insertTask.mockResolvedValue(undefined)
  })

  describe('start', () => {
    it('creates session and sets phase to IDLE', async () => {
      const { service } = createService()

      const result = await service.start(DEFAULT_PRESET_ID)

      expect(result.sessionId).toBe('test-session-uuid')
      expect(result.presetId).toBe(DEFAULT_PRESET_ID)
      expect(result.phase).toBe('IDLE')
      expect(result.queueLength).toBe(0)
    })

    it('returns existing state when called with same preset (idempotent)', async () => {
      const { service } = createService()

      const first = await service.start(DEFAULT_PRESET_ID)
      const second = await service.start(DEFAULT_PRESET_ID)

      expect(first.sessionId).toBe(second.sessionId)
      expect(first.presetId).toBe(second.presetId)
      expect(first.phase).toBe(second.phase)
    })

    it('throws 409 when started with a different preset', async () => {
      const config = createResolvedConfig()
      const secondPreset = {
        ...config.presets[0],
        id: 'anchor-b',
      }
      config.presets.push(secondPreset)
      config.presetMap.set(secondPreset.id, secondPreset)
      const { service } = createService(config)

      await service.start(DEFAULT_PRESET_ID)

      await expect(service.start('anchor-b')).rejects.toMatchObject({
        message: expect.stringContaining('different preset'),
        statusCode: 409,
      })
    })

    it('throws 400 when preset is not found', async () => {
      const { service } = createService()

      await expect(service.start('nonexistent')).rejects.toMatchObject({
        message: expect.stringContaining('not found'),
        statusCode: 400,
      })
    })

    it('accepts debug option', async () => {
      const { service } = createService()

      const result = await service.start(DEFAULT_PRESET_ID, { debug: true })

      expect(result.phase).toBe('IDLE')
    })
  })

  describe('stop', () => {
    it('resets state to STOPPED', async () => {
      const { service } = createService()
      await service.start(DEFAULT_PRESET_ID)

      const result = service.stop()

      expect(result.sessionId).toBeNull()
      expect(result.presetId).toBeNull()
      expect(result.phase).toBe('STOPPED')
      expect(result.queueLength).toBe(0)
    })

    it('is safe to call when already stopped', () => {
      const { service } = createService()

      const result = service.stop()

      expect(result.phase).toBe('STOPPED')
    })
  })

  describe('status', () => {
    it('returns STOPPED state initially', () => {
      const { service } = createService()

      const result = service.status()

      expect(result.sessionId).toBeNull()
      expect(result.presetId).toBeNull()
      expect(result.phase).toBe('STOPPED')
      expect(result.queueLength).toBe(0)
    })

    it('returns IDLE state after start', async () => {
      const { service } = createService()
      await service.start(DEFAULT_PRESET_ID)

      const result = service.status()

      expect(result.phase).toBe('IDLE')
      expect(result.presetId).toBe(DEFAULT_PRESET_ID)
    })
  })

  describe('enqueueText', () => {
    it('sets phase to SPEAK when task is queued', async () => {
      const { service } = createService()
      await service.start(DEFAULT_PRESET_ID)
      const payload: GenerateRequestPayload = {
        presetId: DEFAULT_PRESET_ID,
        requests: [{ action: 'speak', params: { text: 'hello' } }],
      }

      void service.enqueueText(payload)

      const status = service.status()
      expect(status.phase).toBe('SPEAK')
      expect(status.queueLength).toBe(1)
    })

    it('rejects with 409 when stream is stopped', async () => {
      const { service } = createService()
      const payload: GenerateRequestPayload = {
        presetId: DEFAULT_PRESET_ID,
        requests: [{ action: 'speak', params: { text: 'hello' } }],
      }

      await expect(service.enqueueText(payload)).rejects.toMatchObject({
        message: expect.stringContaining('not started'),
        statusCode: 409,
      })
    })

    it('rejects with 409 when presetId does not match', async () => {
      const { service } = createService()
      await service.start(DEFAULT_PRESET_ID)
      const payload: GenerateRequestPayload = {
        presetId: 'different-preset',
        requests: [{ action: 'speak', params: { text: 'hello' } }],
      }

      await expect(service.enqueueText(payload)).rejects.toMatchObject({
        message: expect.stringContaining('does not match'),
        statusCode: 409,
      })
    })

    it('passes forStreamPipeline: true to generationService', async () => {
      const { service, generationService } = createService()
      await service.start(DEFAULT_PRESET_ID)
      const payload: GenerateRequestPayload = {
        presetId: DEFAULT_PRESET_ID,
        requests: [{ action: 'speak', params: { text: 'hello' } }],
      }

      await service.enqueueText(payload)

      expect(generationService.processBatch).toHaveBeenCalledWith(
        expect.objectContaining({
          presetId: DEFAULT_PRESET_ID,
          stream: true,
          forStreamPipeline: true,
        })
      )
    })

    it('returns to IDLE phase after task completes', async () => {
      const { service } = createService()
      await service.start(DEFAULT_PRESET_ID)
      const payload: GenerateRequestPayload = {
        presetId: DEFAULT_PRESET_ID,
        requests: [{ action: 'speak', params: { text: 'hello' } }],
      }

      await service.enqueueText(payload)

      const status = service.status()
      expect(status.phase).toBe('IDLE')
      expect(status.queueLength).toBe(0)
    })

    it('handles multiple queued tasks sequentially', async () => {
      const { service, generationService } = createService()
      await service.start(DEFAULT_PRESET_ID)
      const payload1: GenerateRequestPayload = {
        presetId: DEFAULT_PRESET_ID,
        requests: [{ action: 'speak', params: { text: 'first' } }],
      }
      const payload2: GenerateRequestPayload = {
        presetId: DEFAULT_PRESET_ID,
        requests: [{ action: 'speak', params: { text: 'second' } }],
      }

      const promise1 = service.enqueueText(payload1)
      const promise2 = service.enqueueText(payload2)

      // Both should be queued
      expect(service.status().queueLength).toBe(2)

      await Promise.all([promise1, promise2])

      expect(generationService.processBatch).toHaveBeenCalledTimes(2)
      expect(service.status().queueLength).toBe(0)
      expect(service.status().phase).toBe('IDLE')
    })
  })
})
