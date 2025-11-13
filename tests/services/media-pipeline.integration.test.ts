import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, it, expect, beforeAll } from 'vitest'
import { MediaPipeline } from '../../src/services/media-pipeline'

const execFileAsync = promisify(execFile)
const tempDir = path.resolve(process.cwd(), 'config/tmp/tests-integration')
const videoFixture = path.resolve(process.cwd(), 'tests/fixtures/video/video-test-audio.mp4')

describe('MediaPipeline compose integration', () => {
  let pipeline: MediaPipeline

  beforeAll(() => {
    pipeline = new MediaPipeline(tempDir)
  })

  it('replaces embedded motion audio with the provided track', async () => {
    const jobDir = await pipeline.createJobDir()
    try {
      const silentAudio = await pipeline.createSilentAudio(1000, jobDir)
      const { outputPath } = await pipeline.compose({
        clips: [{ id: 'fixture-video', path: videoFixture, durationMs: 1000 }],
        audioPath: silentAudio,
        durationMs: 1000,
        jobDir,
      })

      const maxVolume = await measureMaxVolumeDb(outputPath)
      expect(maxVolume).toBeLessThanOrEqual(-80)
    } finally {
      await pipeline.removeJobDir(jobDir)
    }
  })
})

async function measureMaxVolumeDb(filePath: string): Promise<number> {
  const { stderr } = await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-i',
    filePath,
    '-af',
    'volumedetect',
    '-f',
    'null',
    '-',
  ])
  const match = stderr.toString().match(/max_volume:\s+(-?\d+(?:\.\d+)?) dB/)
  if (!match) {
    throw new Error('max_volume not found in ffmpeg output')
  }
  return parseFloat(match[1])
}
