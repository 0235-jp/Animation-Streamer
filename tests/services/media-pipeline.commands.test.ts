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
    // hasAudioStream が false を返すようにモック（モーション動画に音声なし）
    runCommandWithOutputMock.mockImplementation(async (_cmd, args) => {
      if (args.includes('-select_streams') && args.includes('a')) {
        return '' // 音声ストリームなし
      }
      return '1.0'
    })
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
    expect(args).toContain('-map')
    expect(args).toContain('0:v:0')
    expect(args).toContain('1:a:0')
  })

  it('passes audio input when audioPath is provided to compose (no motion audio)', async () => {
    // hasAudioStream が false を返すようにモック（モーション動画に音声なし）
    runCommandWithOutputMock.mockImplementation(async (_cmd, args) => {
      if (args.includes('-select_streams') && args.includes('a')) {
        return '' // 音声ストリームなし
      }
      return '1.0'
    })
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.compose({
      clips: [{ id: 'c1', path: '/tmp/clip1.mp4', durationMs: 500 }],
      durationMs: 1000,
      audioPath: '/tmp/audio.wav',
    })

    const args = runCommandMock.mock.calls.at(-1)?.[1] ?? []
    expect(args).toContain('/tmp/audio.wav')
    expect(args.filter((token) => token === '-i')).toHaveLength(2)
    expect(args).toContain('-map')
    expect(args).toContain('0:v:0')
    expect(args).toContain('1:a:0')
  })

  it('mixes motion audio with provided audio when both are available', async () => {
    // hasAudioStream が true を返すようにモック（モーション動画に音声あり）
    runCommandWithOutputMock.mockImplementation(async (_cmd, args) => {
      if (args.includes('-select_streams') && args.includes('a')) {
        return '0' // 音声ストリームあり
      }
      return '1.0'
    })
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.compose({
      clips: [{ id: 'c1', path: '/tmp/clip1.mp4', durationMs: 500 }],
      durationMs: 1000,
      audioPath: '/tmp/audio.wav',
    })

    const args = runCommandMock.mock.calls.at(-1)?.[1] ?? []
    expect(args).toContain('/tmp/audio.wav')
    expect(args).toContain('-filter_complex')
    // amix フィルターが使われていることを確認
    const filterIndex = args.indexOf('-filter_complex')
    expect(filterIndex).toBeGreaterThan(-1)
    const filterArg = args[filterIndex + 1]
    expect(filterArg).toContain('amix=inputs=2')
    expect(filterArg).toContain('normalize=0')
    expect(args).toContain('[aout]')
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

  it('trims audio silence using silenceremove filter with defaults', async () => {
    const pipeline = new MediaPipeline(tempDir)
    await pipeline.trimAudioSilence('/tmp/in.wav')
    const args = runCommandMock.mock.calls.at(-1)?.[1] ?? []
    expect(args).toContain('/tmp/in.wav')
    const filterIndex = args.indexOf('-af')
    expect(filterIndex).toBeGreaterThan(-1)
    const filterArg = args[filterIndex + 1]
    expect(filterArg).toContain(',areverse,')
    expect(filterArg).toContain('silenceremove=start_periods=1:start_threshold=-70dB')
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
