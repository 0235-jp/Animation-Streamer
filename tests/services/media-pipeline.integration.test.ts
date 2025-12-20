import { promises as fs } from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { MediaPipeline } from '../../src/services/media-pipeline'

const execFileAsync = promisify(execFile)
const tempDir = path.resolve(process.cwd(), 'config/tmp/tests-integration')
const videoFixture = path.resolve(process.cwd(), 'tests/fixtures/video/video-test-audio.mp4')

describe('MediaPipeline compose integration', () => {
  let pipeline: MediaPipeline
  let hasFfmpeg = false

  beforeAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(tempDir, { recursive: true })
    pipeline = new MediaPipeline(tempDir)
    try {
      await execFileAsync('ffmpeg', ['-version'])
      hasFfmpeg = true
    } catch {
      hasFfmpeg = false
    }
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('mixes embedded motion audio with the provided track', async () => {
    if (!hasFfmpeg) {
      console.warn('Skipping MediaPipeline compose integration test because ffmpeg is not available')
      return
    }
    const jobDir = await pipeline.createJobDir()
    try {
      const silentAudio = await pipeline.createSilentAudio(1000, jobDir)
      const { outputPath } = await pipeline.compose({
        clips: [{ id: 'fixture-video', path: videoFixture, durationMs: 1000 }],
        audioPath: silentAudio,
        durationMs: 1000,
        jobDir,
      })

      // モーション音声と無音音声がミックスされるので、
      // モーション音声が残っている（-80dBより大きい）ことを確認
      const maxVolume = await measureMaxVolumeDb(outputPath)
      expect(maxVolume).toBeGreaterThan(-80)
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
