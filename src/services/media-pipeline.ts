import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { runCommand, runCommandWithOutput } from '../utils/process'

export interface ClipSource {
  id: string
  path: string
  durationMs: number
}

export interface VideoSpec {
  width: number
  height: number
  frameRate: string
  codec: string
  pixelFormat: string
}

export interface ComposeOptions {
  clips: ClipSource[]
  audioPath?: string
  durationMs: number
  jobDir?: string
}

const escapeSingleQuotes = (value: string) => value.replace(/'/g, "'\\''")
const toSeconds = (ms: number) => (Math.max(ms, 0) / 1000).toFixed(3)
const AUDIO_SAMPLE_RATE = 48_000
const AUDIO_CHANNEL_LAYOUT = 'stereo'
const AUDIO_CHANNEL_COUNT = 2
const DEFAULT_SILENCE_THRESHOLD_DB = -70

export class NoAudioTrackError extends Error {
  constructor(public readonly sourcePath: string) {
    super(`Audio track not found in ${sourcePath}`)
    this.name = 'NoAudioTrackError'
  }
}

export class MediaPipeline {
  private readonly tempDir: string
  private readonly videoDurationCache = new Map<string, number>()
  private readonly audioDurationCache = new Map<string, number>()
  private readonly videoDurationPromises = new Map<string, Promise<number>>()
  private readonly audioDurationPromises = new Map<string, Promise<number>>()

  constructor(tempDir: string) {
    this.tempDir = tempDir
  }

  async createJobDir(): Promise<string> {
    const dir = path.join(this.tempDir, `job-${randomUUID()}`)
    await fs.mkdir(dir, { recursive: true })
    return dir
  }

  async removeJobDir(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true })
  }

  async getVideoDurationMs(videoPath: string): Promise<number> {
    const cached = this.videoDurationCache.get(videoPath)
    if (cached !== undefined) return cached

    const inFlight = this.videoDurationPromises.get(videoPath)
    if (inFlight) return inFlight

    const probePromise = this.runProbe(videoPath)
      .then((duration) => {
        this.videoDurationCache.set(videoPath, duration)
        this.videoDurationPromises.delete(videoPath)
        return duration
      })
      .catch((error) => {
        this.videoDurationPromises.delete(videoPath)
        throw error
      })

    this.videoDurationPromises.set(videoPath, probePromise)
    return probePromise
  }

  async getAudioDurationMs(audioPath: string): Promise<number> {
    const cached = this.audioDurationCache.get(audioPath)
    if (cached !== undefined) return cached

    const inFlight = this.audioDurationPromises.get(audioPath)
    if (inFlight) return inFlight

    const probePromise = this.runProbe(audioPath)
      .then((duration) => {
        this.audioDurationCache.set(audioPath, duration)
        this.audioDurationPromises.delete(audioPath)
        return duration
      })
      .catch((error) => {
        this.audioDurationPromises.delete(audioPath)
        throw error
      })

    this.audioDurationPromises.set(audioPath, probePromise)
    return probePromise
  }

  async compose(options: ComposeOptions): Promise<{ outputPath: string; durationMs: number }> {
    if (!options.clips.length) {
      throw new Error('合成に使用するクリップがありません')
    }
    const jobDir = options.jobDir ?? (await this.createJobDir())
    const concatPath = path.join(jobDir, 'concat.txt')
    const outputPath = path.join(jobDir, `output-${randomUUID()}.mp4`)

    const targetSeconds = Math.max(0.1, options.durationMs / 1000)

    // モーション動画に音声があるかチェック
    const clipAudioChecks = await Promise.all(
      options.clips.map((clip) => this.hasAudioStream(clip.path))
    )
    const hasMotionAudio = clipAudioChecks.some((has) => has)

    // 一部のクリップにのみ音声がある場合、音声がないクリップに無音トラックを追加
    // concat demuxer では全てのクリップに音声が必要
    let effectiveClips = options.clips
    if (hasMotionAudio && !clipAudioChecks.every((has) => has)) {
      effectiveClips = await Promise.all(
        options.clips.map(async (clip, index) => {
          if (clipAudioChecks[index]) {
            return clip
          }
          // 音声がないクリップに無音トラックを追加
          const withAudioPath = await this.ensureAudioTrack(clip.path, jobDir)
          return { ...clip, path: withAudioPath }
        })
      )
    }

    const concatBody = effectiveClips.map((clip) => `file '${escapeSingleQuotes(clip.path)}'`).join('\n')
    await fs.writeFile(concatPath, concatBody, 'utf8')

    const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatPath]

    if (options.audioPath) {
      args.push('-i', options.audioPath)
    }

    // 各パターンに応じた入力・フィルター・マッピングを設定
    let useShortest = false
    let explicitDuration: string | null = null

    if (hasMotionAudio && options.audioPath) {
      // モーション音声とTTS音声の両方がある場合: amix でミックス
      const amixFilter = '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[aout]'
      args.push('-filter_complex', amixFilter, '-map', '0:v:0', '-map', '[aout]')
      useShortest = true
    } else if (options.audioPath) {
      // TTS音声のみ（モーション音声なし）
      args.push('-map', '0:v:0', '-map', '1:a:0')
      useShortest = true
    } else if (hasMotionAudio) {
      // モーション音声のみ（TTS音声なし）
      args.push('-map', '0:v:0', '-map', '0:a:0')
      explicitDuration = targetSeconds.toString()
    } else {
      // 音声なし: 無音音声を生成
      args.push(
        '-f', 'lavfi', '-t', targetSeconds.toString(), '-i',
        `anullsrc=channel_layout=${AUDIO_CHANNEL_LAYOUT}:sample_rate=${AUDIO_SAMPLE_RATE}`,
        '-map', '0:v:0', '-map', '1:a:0'
      )
      explicitDuration = targetSeconds.toString()
    }

    // 共通のエンコード設定
    args.push(
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-ar', AUDIO_SAMPLE_RATE.toString(),
      '-ac', AUDIO_CHANNEL_COUNT.toString()
    )

    // 終了条件
    if (useShortest) {
      args.push('-shortest')
    }
    if (explicitDuration) {
      args.push('-t', explicitDuration)
    }

    args.push(outputPath)

    await runCommand('ffmpeg', args)

    const durationMs = await this.runProbe(outputPath)

    return { outputPath, durationMs }
  }

  async concatFiles(filePaths: string[], jobDir?: string): Promise<{ outputPath: string; durationMs: number }> {
    if (!filePaths.length) {
      throw new Error('結合対象のファイルがありません')
    }
    const dir = jobDir ?? (await this.createJobDir())
    const outputPath = path.join(dir, `concat-${randomUUID()}.mp4`)
    const args = ['-y', '-hide_banner', '-loglevel', 'error']

    for (const file of filePaths) {
      args.push('-i', file)
    }

    const inputs = filePaths
      .map((_file, index) => `[${index}:v][${index}:a]`)
      .join('')
    const concatFilter = `${inputs}concat=n=${filePaths.length}:v=1:a=1[v][a]`

    args.push(
      '-filter_complex',
      concatFilter,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-c:a',
      'aac',
      '-ar',
      AUDIO_SAMPLE_RATE.toString(),
      '-movflags',
      '+faststart',
      outputPath
    )

    await runCommand('ffmpeg', args)

    const durationMs = await this.runProbe(outputPath)

    return { outputPath, durationMs }
  }

  async concatAudioFiles(filePaths: string[], jobDir?: string): Promise<{ outputPath: string; durationMs: number }> {
    if (!filePaths.length) {
      throw new Error('結合対象の音声がありません')
    }
    if (filePaths.length === 1) {
      const singlePath = filePaths[0]
      const durationMs = await this.getAudioDurationMs(singlePath)
      return { outputPath: singlePath, durationMs }
    }
    const dir = jobDir ?? (await this.createJobDir())
    const outputPath = path.join(dir, `audio-concat-${randomUUID()}.wav`)
    const args = ['-y', '-hide_banner', '-loglevel', 'error']
    filePaths.forEach((file) => {
      args.push('-i', file)
    })

    const inputs = filePaths.map((_file, index) => `[${index}:a]`).join('')
    const filter = `${inputs}concat=n=${filePaths.length}:v=0:a=1[a]`

    args.push(
      '-filter_complex',
      filter,
      '-map',
      '[a]',
      '-c:a',
      'pcm_s16le',
      '-ar',
      AUDIO_SAMPLE_RATE.toString(),
      outputPath
    )

    await runCommand('ffmpeg', args)
    const durationMs = await this.getAudioDurationMs(outputPath)
    return { outputPath, durationMs }
  }

  async createSilentAudio(durationMs: number, jobDir?: string): Promise<string> {
    const dir = jobDir ?? (await this.createJobDir())
    const filePath = path.join(dir, `silent-${randomUUID()}.wav`)
    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      `anullsrc=r=${AUDIO_SAMPLE_RATE}:cl=${AUDIO_CHANNEL_LAYOUT}`,
      '-t',
      toSeconds(durationMs),
      '-c:a',
      'pcm_s16le',
      filePath,
    ])
    return filePath
  }

  async extractAudioTrack(videoPath: string, jobDir?: string, prefix = 'action-audio'): Promise<string> {
    const hasAudio = await this.hasAudioStream(videoPath)
    if (!hasAudio) {
      throw new NoAudioTrackError(videoPath)
    }
    const dir = jobDir ?? (await this.createJobDir())
    const filePath = path.join(dir, `${prefix}-${randomUUID()}.wav`)
    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      videoPath,
      '-vn',
      '-ac',
      AUDIO_CHANNEL_COUNT.toString(),
      '-ar',
      AUDIO_SAMPLE_RATE.toString(),
      '-c:a',
      'pcm_s16le',
      filePath,
    ])
    return filePath
  }

  async hasAudioStream(videoPath: string): Promise<boolean> {
    const output = await runCommandWithOutput('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'a',
      '-show_entries',
      'stream=index',
      '-of',
      'csv=p=0',
      videoPath,
    ])
    return output.trim().length > 0
  }

  /**
   * 入力ファイルに音声トラックがなければ無音音声を追加したバージョンを作成する。
   * 音声トラックがあれば jobDir にコピーしたファイルのパスを返す。
   * jobDir が指定されている場合、常に jobDir 内にファイルを作成する。
   */
  async ensureAudioTrack(videoPath: string, jobDir?: string): Promise<string> {
    const hasAudio = await this.hasAudioStream(videoPath)
    const dir = jobDir ?? (await this.createJobDir())
    const outputPath = path.join(dir, `with-audio-${randomUUID()}.mp4`)

    if (hasAudio) {
      // 音声トラックがある場合はそのままコピー
      await runCommand('ffmpeg', [
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        videoPath,
        '-c',
        'copy',
        outputPath,
      ])
      return outputPath
    }

    const durationMs = await this.getVideoDurationMs(videoPath)
    const durationSec = Math.max(0.1, durationMs / 1000)

    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      videoPath,
      '-f',
      'lavfi',
      '-t',
      durationSec.toString(),
      '-i',
      `anullsrc=channel_layout=${AUDIO_CHANNEL_LAYOUT}:sample_rate=${AUDIO_SAMPLE_RATE}`,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ar',
      AUDIO_SAMPLE_RATE.toString(),
      '-ac',
      AUDIO_CHANNEL_COUNT.toString(),
      '-shortest',
      outputPath,
    ])

    return outputPath
  }

  async normalizeAudio(inputPath: string, jobDir?: string, prefix = 'audio'): Promise<string> {
    const dir = jobDir ?? (await this.createJobDir())
    const outputPath = path.join(dir, `${prefix}-${randomUUID()}.wav`)
    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-ac',
      AUDIO_CHANNEL_COUNT.toString(),
      '-ar',
      AUDIO_SAMPLE_RATE.toString(),
      '-c:a',
      'pcm_s16le',
      outputPath,
    ])
    return outputPath
  }

  async trimAudioSilence(
    inputPath: string,
    jobDir?: string,
    prefix = 'audio-trim',
    options?: { silenceThresholdDb?: number }
  ): Promise<string> {
    const dir = jobDir ?? (await this.createJobDir())
    const outputPath = path.join(dir, `${prefix}-${randomUUID()}.wav`)
    const threshold = options?.silenceThresholdDb ?? DEFAULT_SILENCE_THRESHOLD_DB
    const thresholdArg = `${threshold}dB`
    const silenceFilter = ['silenceremove=start_periods=1', `start_threshold=${thresholdArg}`].join(':')
    const filter = [silenceFilter, 'areverse', silenceFilter, 'areverse'].join(',')

    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-af',
      filter,
      '-ac',
      AUDIO_CHANNEL_COUNT.toString(),
      '-ar',
      AUDIO_SAMPLE_RATE.toString(),
      '-c:a',
      'pcm_s16le',
      outputPath,
    ])
    return outputPath
  }

  async fitAudioDuration(inputPath: string, durationMs: number, jobDir?: string, prefix = 'audio-fit'): Promise<string> {
    const dir = jobDir ?? (await this.createJobDir())
    const outputPath = path.join(dir, `${prefix}-${randomUUID()}.wav`)
    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-af',
      'apad',
      '-t',
      toSeconds(durationMs),
      '-ac',
      AUDIO_CHANNEL_COUNT.toString(),
      '-ar',
      AUDIO_SAMPLE_RATE.toString(),
      '-c:a',
      'pcm_s16le',
      outputPath,
    ])
    return outputPath
  }

  /**
   * 複数の音声ファイルをミックス（重ね合わせ）する。
   * normalize=0 で各音声の元の音量を維持したまま合成する。
   */
  async mixAudioFiles(filePaths: string[], durationMs: number, jobDir?: string): Promise<string> {
    if (!filePaths.length) {
      throw new Error('ミックス対象の音声がありません')
    }
    if (filePaths.length === 1) {
      return filePaths[0]
    }
    const dir = jobDir ?? (await this.createJobDir())
    const outputPath = path.join(dir, `audio-mix-${randomUUID()}.wav`)
    const args = ['-y', '-hide_banner', '-loglevel', 'error']

    for (const file of filePaths) {
      args.push('-i', file)
    }

    // amix フィルターで音声をミックス（normalize=0 で元の音量を維持）
    const amixFilter = `amix=inputs=${filePaths.length}:duration=longest:normalize=0`

    args.push(
      '-filter_complex',
      amixFilter,
      '-t',
      toSeconds(durationMs),
      '-ac',
      AUDIO_CHANNEL_COUNT.toString(),
      '-ar',
      AUDIO_SAMPLE_RATE.toString(),
      '-c:a',
      'pcm_s16le',
      outputPath
    )

    await runCommand('ffmpeg', args)
    return outputPath
  }

  async extractSegment(sourcePath: string, startMs: number, durationMs: number, prefix: string, jobDir?: string): Promise<string> {
    const dir = jobDir ?? (await this.createJobDir())
    const outputPath = path.join(dir, `${prefix}-${randomUUID()}.mp4`)
    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-ss',
      toSeconds(startMs),
      '-i',
      sourcePath,
      '-t',
      toSeconds(durationMs),
      '-c',
      'copy',
      outputPath,
    ])
    return outputPath
  }

  private async runProbe(filePath: string): Promise<number> {
    const output = await runCommandWithOutput('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ])
    const value = parseFloat(output.trim())
    if (!Number.isFinite(value)) {
      throw new Error(`ffprobeでメディア長を取得できませんでした: ${filePath}`)
    }
    return value * 1000
  }

  async getVideoSpec(videoPath: string): Promise<VideoSpec> {
    const output = await runCommandWithOutput('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=width,height,r_frame_rate,codec_name,pix_fmt',
      '-of',
      'json',
      videoPath,
    ])
    let data: { streams?: Array<Record<string, unknown>> }
    try {
      data = JSON.parse(output)
    } catch {
      throw new Error(`ffprobeの出力をパースできませんでした: ${videoPath}`)
    }
    const stream = data.streams?.[0]
    if (!stream) {
      throw new Error(`動画ストリームが見つかりません: ${videoPath}`)
    }
    return {
      width: stream.width as number,
      height: stream.height as number,
      frameRate: stream.r_frame_rate as string,
      codec: stream.codec_name as string,
      pixelFormat: stream.pix_fmt as string,
    }
  }
}
