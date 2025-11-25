import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn, type ChildProcess } from 'node:child_process'
import { logger } from '../utils/logger'
import type { ResolvedPreset } from '../config/loader'
import type { ClipPlanner } from './clip-planner'
import type { ClipSource, MediaPipeline } from './media-pipeline'

const FFCONCAT_HEADER = 'ffconcat version 1.0'
const MIN_IDLE_MS = 1200
const AUDIO_SAMPLE_RATE = 48_000
const AUDIO_CHANNEL_COUNT = 2
const CLEANUP_MARGIN_MS = 10_000 // FFmpegがファイルを解放するまでの余裕

const writeAtomic = async (dest: string, content: string) => {
  const tmp = `${dest}.${process.pid}.tmp`
  await fs.writeFile(tmp, content, 'utf8')
  await fs.rename(tmp, dest)
}

const escapeSingleQuotes = (value: string) => value.replace(/'/g, "'\\''")

export class IdleLoopController {
  private ffmpeg: ChildProcess | null = null
  private currentPreset: ResolvedPreset | null = null
  private pendingRestore: NodeJS.Timeout | null = null
  private pendingIdleRotation: NodeJS.Timeout | null = null
  private stopping = false
  private startedOnce = false
  private currentIdleClipPath: string | null = null

  constructor(
    private readonly options: {
      clipPlanner: ClipPlanner
      mediaPipeline: MediaPipeline
      workDir: string
      outputUrl: string
      debug?: boolean
    }
  ) {}

  private get debug(): boolean {
    return this.options.debug ?? false
  }

  private async ensureWorkdir(): Promise<void> {
    await fs.mkdir(this.options.workDir, { recursive: true })
  }

  private async clearWorkDir(): Promise<void> {
    if (this.debug) return
    try {
      const entries = await fs.readdir(this.options.workDir)
      await Promise.all(
        entries.map((entry) => fs.rm(path.join(this.options.workDir, entry), { force: true }))
      )
      logger.info({ workDir: this.options.workDir }, 'Cleared stream work directory')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn({ err }, 'Failed to clear work directory')
      }
    }
  }

  private scheduleFileCleanup(filePaths: string[], delayMs: number): void {
    if (this.debug) return
    setTimeout(() => {
      for (const filePath of filePaths) {
        fs.rm(filePath, { force: true }).catch((err) => {
          logger.warn({ err, filePath }, 'Failed to cleanup file')
        })
      }
    }, delayMs)
  }

  private async buildSingleIdleClip(presetId: string): Promise<ClipSource> {
    // MIN_IDLE_MSを指定してbuildIdlePlanを呼ぶと、1つのクリップがランダムに選ばれる
    const plan = await this.options.clipPlanner.buildIdlePlan(presetId, MIN_IDLE_MS)
    const clip = plan.clips[0]
    // 音声トラックがあることを保証する（なければ無音を追加）
    const pathWithAudio = await this.options.mediaPipeline.ensureAudioTrack(clip.path, this.options.workDir)
    return {
      ...clip,
      path: pathWithAudio,
    }
  }

  private async scheduleNextIdleClip(): Promise<void> {
    if (this.stopping || !this.currentPreset) return

    try {
      // 前のidleクリップがworkDir内のファイルなら削除をスケジュール
      const prevPath = this.currentIdleClipPath
      if (prevPath && prevPath.startsWith(this.options.workDir)) {
        this.scheduleFileCleanup([prevPath], CLEANUP_MARGIN_MS)
      }

      const clip = await this.buildSingleIdleClip(this.currentPreset.id)
      this.currentIdleClipPath = clip.path
      await this.writeIdleLoop([clip])

      // クリップの長さ後に次のクリップに更新
      if (this.pendingIdleRotation) clearTimeout(this.pendingIdleRotation)
      this.pendingIdleRotation = setTimeout(() => {
        void this.scheduleNextIdleClip().catch((err) =>
          logger.error({ err }, 'Failed to rotate idle clip')
        )
      }, clip.durationMs)
    } catch (err) {
      logger.error({ err }, 'Failed to schedule next idle clip')
    }
  }

  private async writeIdleLoop(clips: ClipSource[]): Promise<void> {
    const playlistPath = path.join(this.options.workDir, 'idle.txt')
    const lines = [
      FFCONCAT_HEADER,
      ...clips.map((clip) => `file '${escapeSingleQuotes(path.relative(this.options.workDir, clip.path))}'`),
      `file 'idle.txt'`,
    ]
    await writeAtomic(playlistPath, `${lines.join('\n')}\n`)
  }

  async start(preset: ResolvedPreset): Promise<void> {
    this.stopping = false
    await this.ensureWorkdir()
    await this.clearWorkDir()
    this.currentPreset = preset
    this.currentIdleClipPath = null

    // 最初のidleクリップを選んでidle.txtに書き込み、ローテーションを開始
    const initialClip = await this.buildSingleIdleClip(preset.id)
    this.currentIdleClipPath = initialClip.path
    await this.writeIdleLoop([initialClip])

    // クリップの長さ後に次のクリップに更新するタイマーを設定
    this.pendingIdleRotation = setTimeout(() => {
      void this.scheduleNextIdleClip().catch((err) =>
        logger.error({ err }, 'Failed to rotate idle clip')
      )
    }, initialClip.durationMs)

    if (this.ffmpeg && !this.ffmpeg.killed) {
      this.ffmpeg.kill('SIGKILL')
    }

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      path.join(this.options.workDir, 'idle.txt'),
      // 映像と音声を明示的にマップ
      // ffconcatの入力に音声トラックがあればそれを使用する
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-ar',
      AUDIO_SAMPLE_RATE.toString(),
      '-ac',
      AUDIO_CHANNEL_COUNT.toString(),
      '-f',
      'flv',
      this.options.outputUrl,
    ]

    const child = spawn('ffmpeg', args, {
      cwd: this.options.workDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      const t = String(chunk).trim()
      if (t) logger.info({ stream: 'ffmpeg', msg: t })
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => {
      const t = String(chunk).trim()
      if (t) logger.error({ stream: 'ffmpeg', msg: t })
    })
    child.on('exit', (code, signal) => {
      this.ffmpeg = null
      logger.warn({ code, signal }, 'ffmpeg exited')
      const shouldRestart = !this.stopping && this.currentPreset && code === 0
      if (shouldRestart) {
        setTimeout(() => {
          void this.start(this.currentPreset as ResolvedPreset).catch((err) =>
            logger.error({ err }, 'Failed to restart ffmpeg')
          )
        }, 1000)
      }
    })
    this.ffmpeg = child
    this.startedOnce = true
  }

  async insertTask(taskClips: ClipSource[], presetId: string): Promise<void> {
    if (!this.currentPreset || this.currentPreset.id !== presetId) {
      throw new Error('Preset mismatch for stream task')
    }
    if (!this.ffmpeg) {
      throw new Error('Stream is not running')
    }
    const taskPlaylistPath = path.join(this.options.workDir, `task-${randomUUID()}.txt`)
    const idlePad = await this.options.clipPlanner.buildIdlePlan(presetId, MIN_IDLE_MS)

    // idlePadのクリップに音声トラックを保証
    const idlePadClipsWithAudio: ClipSource[] = []
    for (const clip of idlePad.clips) {
      const pathWithAudio = await this.options.mediaPipeline.ensureAudioTrack(clip.path, this.options.workDir)
      idlePadClipsWithAudio.push({
        ...clip,
        path: pathWithAudio,
      })
    }

    // task-xxx.txtにはspeakクリップのみを含める
    // idle.txtへの参照は不要（idle.txtがtask-xxx.txtの後にidle.txt参照を持っているため）
    // task-xxx.txt内にidle.txt参照があると、タイマーで復元される前に参照されて2回再生される
    const taskLines = [
      FFCONCAT_HEADER,
      ...taskClips.map(
        (clip) => `file '${escapeSingleQuotes(path.relative(this.options.workDir, clip.path))}'`
      ),
    ]
    await writeAtomic(taskPlaylistPath, `${taskLines.join('\n')}\n`)

    const idleTxtPath = path.join(this.options.workDir, 'idle.txt')
    const patchedLines = [
      FFCONCAT_HEADER,
      ...idlePadClipsWithAudio.map((clip) => `file '${escapeSingleQuotes(path.relative(this.options.workDir, clip.path))}'`),
      `file '${escapeSingleQuotes(path.relative(this.options.workDir, taskPlaylistPath))}'`,
      `file 'idle.txt'`,
    ]
    await writeAtomic(idleTxtPath, `${patchedLines.join('\n')}\n`)

    // タスク実行中はidleローテーションを一時停止
    if (this.pendingIdleRotation) clearTimeout(this.pendingIdleRotation)
    this.pendingIdleRotation = null

    // taskが終わったらすぐにidleローテーションを再開
    const totalMs =
      taskClips.reduce((sum, clip) => sum + (clip.durationMs ?? 0), 0) + idlePad.totalDurationMs
    if (this.pendingRestore) clearTimeout(this.pendingRestore)
    this.pendingRestore = setTimeout(() => {
      void this.scheduleNextIdleClip().catch((err) =>
        logger.error({ err }, 'Failed to restart idle rotation')
      )
    }, totalMs)

    // タスク再生完了後に不要なファイルを削除
    const filesToCleanup = [
      taskPlaylistPath,
      ...taskClips.map((clip) => clip.path),
      ...idlePadClipsWithAudio
        .filter((clip) => clip.path.startsWith(this.options.workDir))
        .map((clip) => clip.path),
    ]
    this.scheduleFileCleanup(filesToCleanup, totalMs + CLEANUP_MARGIN_MS)
  }

  async stop(): Promise<void> {
    this.stopping = true
    this.currentPreset = null
    this.currentIdleClipPath = null
    if (this.pendingRestore) clearTimeout(this.pendingRestore)
    this.pendingRestore = null
    if (this.pendingIdleRotation) clearTimeout(this.pendingIdleRotation)
    this.pendingIdleRotation = null
    if (!this.ffmpeg) return
    const proc = this.ffmpeg
    this.ffmpeg = null
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL')
    }, 2000)
    // FFmpeg終了後にワークディレクトリをクリア
    setTimeout(() => {
      void this.clearWorkDir()
    }, 3000)
  }
}
