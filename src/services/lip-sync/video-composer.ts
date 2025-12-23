import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { runCommand, runCommandWithOutput } from '../../utils/process'
import type { VisemeSegment, VisemeType } from '../../types/generate'
import type { ResolvedLipSyncImages } from '../../config/loader'

const AUDIO_SAMPLE_RATE = 48_000
const AUDIO_CHANNEL_COUNT = 2
const DEFAULT_FRAME_RATE = 30

export interface LipSyncComposeOptions {
  /** ビゼムタイムライン */
  timeline: VisemeSegment[]
  /** 画像セット（ビゼムタイプ→画像パス） */
  images: ResolvedLipSyncImages
  /** 音声ファイルパス */
  audioPath: string
  /** 作業ディレクトリ */
  jobDir: string
  /** フレームレート（デフォルト: 30） */
  frameRate?: number
}

export interface LipSyncComposeResult {
  outputPath: string
  durationMs: number
}

/**
 * リップシンク動画を合成する
 * 各セグメントを個別に生成し、concatで連結
 */
export async function composeLipSyncVideo(options: LipSyncComposeOptions): Promise<LipSyncComposeResult> {
  const { timeline, images, audioPath, jobDir, frameRate = DEFAULT_FRAME_RATE } = options

  if (timeline.length === 0) {
    throw new Error('ビゼムタイムラインが空です')
  }

  const totalDurationMs = timeline[timeline.length - 1].endMs

  // 1. 各セグメントの動画を生成
  const segmentPaths: string[] = []
  for (let i = 0; i < timeline.length; i++) {
    const segment = timeline[i]
    const imagePath = getImagePath(images, segment.viseme)
    const durationMs = segment.endMs - segment.startMs

    const segmentPath = await createSegmentVideo(imagePath, durationMs, frameRate, jobDir, `seg-${i}`)
    segmentPaths.push(segmentPath)
  }

  // 2. concatファイルを作成
  const concatPath = path.join(jobDir, `concat-${randomUUID()}.txt`)
  const concatContent = segmentPaths.map((p) => `file '${escapeSingleQuotes(p)}'`).join('\n')
  await fs.writeFile(concatPath, concatContent, 'utf8')

  // 3. 連結（音声なし）
  const videoOnlyPath = path.join(jobDir, `video-only-${randomUUID()}.mp4`)
  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concatPath,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    videoOnlyPath,
  ])

  // 4. 音声を合成（動画の長さに合わせる、最後のclosedフレームを含めるため）
  const outputPath = path.join(jobDir, `lip-sync-${randomUUID()}.mp4`)
  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    videoOnlyPath,
    '-i',
    audioPath,
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
    outputPath,
  ])

  // 5. 中間ファイルを削除
  await Promise.all([
    ...segmentPaths.map((p) => fs.rm(p, { force: true })),
    fs.rm(concatPath, { force: true }),
    fs.rm(videoOnlyPath, { force: true }),
  ])

  return {
    outputPath,
    durationMs: totalDurationMs,
  }
}

/**
 * 静止画から指定時間のビデオセグメントを生成
 */
async function createSegmentVideo(
  imagePath: string,
  durationMs: number,
  frameRate: number,
  jobDir: string,
  prefix: string
): Promise<string> {
  const durationSec = Math.max(0.001, durationMs / 1000)
  const outputPath = path.join(jobDir, `${prefix}-${randomUUID()}.mp4`)

  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-loop',
    '1',
    '-i',
    imagePath,
    '-t',
    durationSec.toFixed(3),
    '-r',
    String(frameRate),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    outputPath,
  ])

  return outputPath
}

/**
 * ビゼムタイプから対応する画像パスを取得
 * aiueoN形式（A, I, U, E, O, N）
 */
function getImagePath(images: ResolvedLipSyncImages, viseme: VisemeType): string {
  return images[viseme]
}

/**
 * シングルクォートをエスケープ
 */
function escapeSingleQuotes(value: string): string {
  return value.replace(/'/g, "'\\''")
}

/**
 * 画像から解像度を取得
 */
export async function getImageDimensions(imagePath: string): Promise<{ width: number; height: number }> {
  const output = await runCommandWithOutput('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'json',
    imagePath,
  ])

  const data = JSON.parse(output)
  const stream = data.streams?.[0]
  if (!stream) {
    throw new Error(`画像の解像度を取得できませんでした: ${imagePath}`)
  }
  return {
    width: stream.width as number,
    height: stream.height as number,
  }
}
