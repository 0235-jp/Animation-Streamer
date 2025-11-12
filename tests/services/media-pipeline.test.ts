import path from 'node:path'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import { MediaPipeline } from '../../src/services/media-pipeline'

const runCommandWithOutputMock = vi.fn<Promise<string>, any>()

vi.mock('../../src/utils/process', () => ({
  runCommand: vi.fn().mockResolvedValue(undefined),
  runCommandWithOutput: (...args: any[]) => runCommandWithOutputMock(...args),
}))

describe('MediaPipeline audio helpers', () => {
  let mediaPipeline: MediaPipeline
  let fixturePath: string

  beforeAll(() => {
    const tempDir = path.resolve(process.cwd(), 'config/tmp/tests')
    mediaPipeline = new MediaPipeline(tempDir)
    fixturePath = path.resolve(process.cwd(), 'tests/fixtures/audio/voicevox-hello.wav')
  })

  it('measures audio duration once and caches the result', async () => {
    runCommandWithOutputMock.mockResolvedValueOnce('1.23')
    const firstDuration = await mediaPipeline.getAudioDurationMs(fixturePath)
    runCommandWithOutputMock.mockResolvedValueOnce('1.23')
    const secondDuration = await mediaPipeline.getAudioDurationMs(fixturePath)

    expect(firstDuration).toBeGreaterThan(0)
    expect(secondDuration).toBe(firstDuration)
    const cache = (mediaPipeline as unknown as { audioDurationCache: Map<string, number> }).audioDurationCache
    expect(cache.get(fixturePath)).toBe(firstDuration)
  })
})
