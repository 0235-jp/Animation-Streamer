import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'
import { MediaPipeline, NoAudioTrackError } from '../../src/services/media-pipeline'
import { runCommand, runCommandWithOutput } from '../../src/utils/process'

vi.mock('../../src/utils/process', () => ({
  runCommand: vi.fn().mockResolvedValue(undefined),
  runCommandWithOutput: vi.fn().mockResolvedValue('1.0'),
}))

const runCommandMock = vi.mocked(runCommand)
const runCommandWithOutputMock = vi.mocked(runCommandWithOutput)

const tempDir = path.resolve(process.cwd(), 'config/tmp/tests-commands')

describe('MediaPipeline command building', () => {
  beforeAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
    await fs.mkdir(tempDir, { recursive: true })
  })

  beforeEach(() => {
    runCommandMock.mockClear()
    runCommandWithOutputMock.mockReset()
    runCommandWithOutputMock.mockResolvedValue('1.0')
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('invokes ffmpeg concat with silent audio when no audio track is provided', async () => {
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.compose({
      clips: [{ id: 'c1', path: '/tmp/clip1.mp4', durationMs: 500 }],
      durationMs: 1000,
    })

    expect(runCommandMock).toHaveBeenCalled()
    const args = runCommandMock.mock.calls[0][1]
    expect(args).toContain('-f')
    expect(args).toContain('concat')
    expect(args).toContain(`anullsrc=channel_layout=stereo:sample_rate=48000`)
  })

  it('passes audio input when audioPath is provided to compose', async () => {
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.compose({
      clips: [{ id: 'c1', path: '/tmp/clip1.mp4', durationMs: 500 }],
      durationMs: 1000,
      audioPath: '/tmp/audio.wav',
    })

    const args = runCommandMock.mock.calls.at(-1)?.[1] ?? []
    expect(args).toContain('/tmp/audio.wav')
    expect(args.filter((token) => token === '-i')).toHaveLength(2)
  })

  it('returns cached duration when concatenating a single audio file', async () => {
    const pipeline = new MediaPipeline(tempDir)
    const result = await pipeline.concatAudioFiles(['/tmp/audio.wav'])
    expect(result).toEqual({ outputPath: '/tmp/audio.wav', durationMs: 1000 })
    expect(runCommandMock).not.toHaveBeenCalled()
    expect(runCommandWithOutputMock).toHaveBeenCalledTimes(1)
  })

  it('throws NoAudioTrackError when extractAudioTrack finds no stream', async () => {
    runCommandWithOutputMock.mockReset()
    runCommandWithOutputMock.mockResolvedValueOnce('')
    runCommandWithOutputMock.mockResolvedValue('1.0')
    const pipeline = new MediaPipeline(tempDir)
    await expect(pipeline.extractAudioTrack('/tmp/video.mp4')).rejects.toBeInstanceOf(NoAudioTrackError)
  })

  it('builds silent audio with requested duration', async () => {
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.createSilentAudio(1500)
    const args = runCommandMock.mock.calls.at(-1)?.[1] ?? []
    expect(args).toContain('anullsrc=r=48000:cl=stereo')
    expect(args).toContain('1.500')
  })

  it('normalizes audio with expected ffmpeg arguments', async () => {
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.normalizeAudio('/tmp/in.wav')
    const args = runCommandMock.mock.calls.at(-1)?.[1] ?? []
    expect(args).toContain('/tmp/in.wav')
    expect(args).toContain('-ac')
    expect(args).toContain('2')
    expect(args).toContain('-ar')
    expect(args).toContain('48000')
    expect(args).toContain('-c:a')
    expect(args).toContain('pcm_s16le')
  })

  it('fits audio duration by padding and truncating to requested length', async () => {
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.fitAudioDuration('/tmp/in.wav', 2500)
    const args = runCommandMock.mock.calls.at(-1)?.[1] ?? []
    expect(args).toContain('-af')
    expect(args).toContain('apad')
    expect(args).toContain('-t')
    expect(args).toContain('2.500')
  })

  it('concats multiple video files using filter_complex concat', async () => {
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.concatFiles(['/tmp/a.mp4', '/tmp/b.mp4'])
    const args = runCommandMock.mock.calls.find((call) => call[1].includes('-filter_complex'))?.[1] ?? []
    expect(args).toContain('-filter_complex')
    const filterArg = args[args.indexOf('-filter_complex') + 1]
    expect(filterArg).toContain('concat=n=2:v=1:a=1')
    expect(args.filter((token) => token === '-i')).toHaveLength(2)
  })

  it('extracts video segments with ss/t arguments', async () => {
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.extractSegment('/tmp/source.mp4', 500, 1500, 'clip')
    const args = runCommandMock.mock.calls.at(-1)?.[1] ?? []
    expect(args).toContain('-ss')
    expect(args).toContain('0.500')
    expect(args).toContain('-t')
    expect(args).toContain('1.500')
    expect(args).toContain('/tmp/source.mp4')
  })
})
