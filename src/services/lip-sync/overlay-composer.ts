import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { runCommand } from '../../utils/process'
import type { VisemeSegment, VisemeType } from '../../types/generate'
import type { ResolvedLipSyncImages, ResolvedOverlayConfig } from '../../config/loader'
import type { MouthPositionData, MouthPosition } from './types'

const AUDIO_SAMPLE_RATE = 48_000
const AUDIO_CHANNEL_COUNT = 2
const DEFAULT_FRAME_RATE = 30

export interface OverlayComposeOptions {
  /** ビゼムタイムライン */
  timeline: VisemeSegment[]
  /** 画像セット（ビゼムタイプ→画像パス） */
  images: ResolvedLipSyncImages
  /** ベース動画パス */
  baseVideoPath: string
  /** 口位置データ */
  mouthData: MouthPositionData
  /** 音声ファイルパス */
  audioPath: string
  /** 作業ディレクトリ */
  jobDir: string
  /** オーバーレイ設定 */
  overlayConfig: ResolvedOverlayConfig
  /** フレームレート（デフォルト: 30） */
  frameRate?: number
}

export interface OverlayComposeResult {
  outputPath: string
  durationMs: number
}

/**
 * 口位置JSONファイルを読み込む
 */
export async function loadMouthPositionData(jsonPath: string): Promise<MouthPositionData> {
  const content = await fs.readFile(jsonPath, 'utf8')
  return JSON.parse(content) as MouthPositionData
}

/**
 * オーバーレイ合成でリップシンク動画を生成
 * ベース動画の各フレームに対して、タイムラインに応じた口画像をオーバーレイする
 */
export async function composeOverlayLipSyncVideo(
  options: OverlayComposeOptions
): Promise<OverlayComposeResult> {
  const {
    timeline,
    images,
    baseVideoPath,
    mouthData,
    audioPath,
    jobDir,
    overlayConfig,
    frameRate = DEFAULT_FRAME_RATE,
  } = options

  if (timeline.length === 0) {
    throw new Error('ビゼムタイムラインが空です')
  }

  const totalDurationMs = timeline[timeline.length - 1].endMs
  const totalDurationSec = totalDurationMs / 1000

  // 1. ベース動画を必要な長さにループ
  const loopedVideoPath = path.join(jobDir, `looped-${randomUUID()}.mp4`)
  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-stream_loop',
    '-1',
    '-i',
    baseVideoPath,
    '-t',
    totalDurationSec.toFixed(3),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-an',
    loopedVideoPath,
  ])

  // 2. フィルターグラフを構築
  const { filterComplex, inputFiles, outputLabel } = buildOverlayFilterComplex(
    timeline,
    images,
    mouthData,
    overlayConfig,
    frameRate
  )

  // 3. オーバーレイ合成
  const videoOnlyPath = path.join(jobDir, `overlay-video-${randomUUID()}.mp4`)

  const ffmpegArgs: string[] = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    loopedVideoPath,
  ]

  // 口画像を入力として追加
  for (const inputFile of inputFiles) {
    ffmpegArgs.push('-i', inputFile)
  }

  ffmpegArgs.push(
    '-filter_complex',
    filterComplex,
    '-map',
    outputLabel,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-r',
    String(frameRate),
    videoOnlyPath
  )

  await runCommand('ffmpeg', ffmpegArgs)

  // 4. 音声を合成
  const outputPath = path.join(jobDir, `lip-sync-overlay-${randomUUID()}.mp4`)
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
    fs.rm(loopedVideoPath, { force: true }),
    fs.rm(videoOnlyPath, { force: true }),
  ])

  return {
    outputPath,
    durationMs: totalDurationMs,
  }
}

/**
 * FFmpegのフィルターグラフを構築
 */
function buildOverlayFilterComplex(
  timeline: VisemeSegment[],
  images: ResolvedLipSyncImages,
  mouthData: MouthPositionData,
  config: ResolvedOverlayConfig,
  frameRate: number
): { filterComplex: string; inputFiles: string[]; outputLabel: string } {
  // 各ビゼムタイプの画像パスをリストアップ
  const visemeTypes: VisemeType[] = ['A', 'I', 'U', 'E', 'O', 'N']
  const inputFiles = visemeTypes.map((v) => images[v])

  // 入力インデックスのマップ（0はベース動画、1-6は口画像）
  const visemeInputIndex: Record<VisemeType, number> = {
    A: 1,
    I: 2,
    U: 3,
    E: 4,
    O: 5,
    N: 6,
  }

  const filters: string[] = []
  let currentInput = '[0:v]'
  let outputCounter = 0

  // 隣接する同じビゼムのセグメントを統合
  const mergedTimeline = mergeAdjacentSegments(timeline)

  for (let i = 0; i < mergedTimeline.length; i++) {
    const segment = mergedTimeline[i]
    const inputIdx = visemeInputIndex[segment.viseme]

    // セグメント中央の時刻から口位置を取得
    const midTimeSeconds = (segment.startMs + segment.endMs) / 2000
    const pos = getMouthPositionAtTime(mouthData, midTimeSeconds)

    // 口画像のサイズと位置を計算
    const targetWidth = Math.round(pos.width * config.scale)
    const targetHeight = Math.round(pos.height * config.scale)
    const overlayX = Math.round(pos.centerX - targetWidth / 2 + config.offsetX)
    const overlayY = Math.round(pos.centerY - targetHeight / 2 + config.offsetY)

    const startTime = (segment.startMs / 1000).toFixed(4)
    const endTime = (segment.endMs / 1000).toFixed(4)

    const scaleLabel = `[s${i}]`
    const outputLabel = `[v${outputCounter}]`

    // 口画像をスケーリング
    filters.push(`[${inputIdx}:v]scale=${targetWidth}:${targetHeight}${scaleLabel}`)

    // オーバーレイ（時間条件付き）
    filters.push(
      `${currentInput}${scaleLabel}overlay=` +
        `x=${overlayX}:y=${overlayY}:` +
        `enable='between(t,${startTime},${endTime})'` +
        `${outputLabel}`
    )

    currentInput = outputLabel
    outputCounter++
  }

  return {
    filterComplex: filters.join(';'),
    inputFiles,
    outputLabel: currentInput,
  }
}

/**
 * 指定時刻の口位置を取得（補間あり）
 */
function getMouthPositionAtTime(mouthData: MouthPositionData, timeSeconds: number): MouthPosition {
  const { positions, frameRate, totalFrames } = mouthData

  if (positions.length === 0) {
    // フォールバック: 動画中央を想定
    return {
      frameIndex: 0,
      timeSeconds: 0,
      centerX: mouthData.videoWidth / 2,
      centerY: mouthData.videoHeight * 0.7,
      width: mouthData.videoWidth * 0.2,
      height: mouthData.videoHeight * 0.1,
      confidence: 0,
    }
  }

  // ループ動画なので、時刻を動画の長さで剰余を取る
  const videoDuration = totalFrames / frameRate
  const loopedTime = timeSeconds % videoDuration

  // フレームインデックスを計算
  const frameIndex = Math.floor(loopedTime * frameRate) % positions.length

  return positions[frameIndex]
}

/**
 * 隣接する同じビゼムのセグメントを統合
 */
function mergeAdjacentSegments(timeline: VisemeSegment[]): VisemeSegment[] {
  if (timeline.length === 0) return []

  const merged: VisemeSegment[] = []
  let current = { ...timeline[0] }

  for (let i = 1; i < timeline.length; i++) {
    const segment = timeline[i]
    if (segment.viseme === current.viseme) {
      // 同じビゼムなら統合
      current.endMs = segment.endMs
    } else {
      merged.push(current)
      current = { ...segment }
    }
  }
  merged.push(current)

  return merged
}
