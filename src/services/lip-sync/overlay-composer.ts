import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { runCommand } from '../../utils/process'
import type { VisemeSegment, VisemeType } from '../../types/generate'
import type { ResolvedLipSyncImages, ResolvedOverlayConfig } from '../../config/loader'
import type { MouthPositionData, MouthPosition } from './types'
import type { LipSyncClipSource } from '../clip-planner'

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

export interface MultiSegmentComposeOptions {
  /** クリッププラン */
  clips: LipSyncClipSource[]
  /** ビゼムタイムライン */
  timeline: VisemeSegment[]
  /** 音声ファイルパス */
  audioPath: string
  /** 作業ディレクトリ */
  jobDir: string
  /** フレームレート（デフォルト: 30） */
  frameRate?: number
}

/**
 * 複数のlipSyncバリアントを連結してリップシンク動画を生成
 * ClipPlannerが決定した計画に基づいて各セグメントを処理し、連結する
 */
export async function composeMultiSegmentLipSyncVideo(
  options: MultiSegmentComposeOptions
): Promise<OverlayComposeResult> {
  const { clips, timeline, audioPath, jobDir, frameRate = DEFAULT_FRAME_RATE } = options

  if (clips.length === 0) {
    throw new Error('lipSyncクリップがありません')
  }

  if (timeline.length === 0) {
    throw new Error('ビゼムタイムラインが空です')
  }

  const totalDurationMs = timeline[timeline.length - 1].endMs

  // 単一クリップの場合は既存関数をそのまま使用
  if (clips.length === 1) {
    const clip = clips[0]
    const mouthData = await loadMouthPositionData(clip.variant.mouthDataPath)
    return composeOverlayLipSyncVideo({
      timeline,
      images: clip.variant.images,
      baseVideoPath: clip.variant.basePath,
      mouthData,
      audioPath,
      jobDir,
      overlayConfig: clip.variant.overlayConfig,
      frameRate,
    })
  }

  // 各クリップのセグメント境界を計算
  const segmentBoundaries: { startMs: number; endMs: number; clip: LipSyncClipSource }[] = []
  let currentMs = 0
  for (const clip of clips) {
    segmentBoundaries.push({
      startMs: currentMs,
      endMs: currentMs + clip.durationMs,
      clip,
    })
    currentMs += clip.durationMs
  }

  // 各セグメントの動画を生成
  const segmentVideoPaths: string[] = []

  for (let i = 0; i < segmentBoundaries.length; i++) {
    const boundary = segmentBoundaries[i]
    const { clip, startMs, endMs } = boundary

    // このセグメントに対応するタイムラインを抽出・調整
    const segmentTimeline = extractAndAdjustTimeline(timeline, startMs, endMs)

    if (segmentTimeline.length === 0) {
      // タイムラインがない場合は無音として N を使用
      segmentTimeline.push({
        startMs: 0,
        endMs: endMs - startMs,
        viseme: 'N',
      })
    }

    const mouthData = await loadMouthPositionData(clip.variant.mouthDataPath)

    // 各セグメントで音声なしの動画を生成
    const segmentVideoPath = path.join(jobDir, `segment-${i}-${randomUUID()}.mp4`)
    const segmentDurationMs = endMs - startMs
    const segmentDurationSec = segmentDurationMs / 1000

    // ベース動画をループ
    const loopedVideoPath = path.join(jobDir, `looped-seg-${i}-${randomUUID()}.mp4`)
    await runCommand('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-stream_loop',
      '-1',
      '-i',
      clip.variant.basePath,
      '-t',
      segmentDurationSec.toFixed(3),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-an',
      loopedVideoPath,
    ])

    // フィルターグラフを構築
    const { filterComplex, inputFiles, outputLabel } = buildOverlayFilterComplex(
      segmentTimeline,
      clip.variant.images,
      mouthData,
      clip.variant.overlayConfig,
      frameRate
    )

    // オーバーレイ合成
    const ffmpegArgs: string[] = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      loopedVideoPath,
    ]

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
      segmentVideoPath
    )

    await runCommand('ffmpeg', ffmpegArgs)

    segmentVideoPaths.push(segmentVideoPath)

    // 中間ファイル削除
    await fs.rm(loopedVideoPath, { force: true })
  }

  // 全セグメントを連結
  const concatListPath = path.join(jobDir, `concat-list-${randomUUID()}.txt`)
  const concatContent = segmentVideoPaths.map((p) => `file '${p}'`).join('\n')
  await fs.writeFile(concatListPath, concatContent)

  const concatenatedVideoPath = path.join(jobDir, `concat-${randomUUID()}.mp4`)
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
    concatListPath,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    concatenatedVideoPath,
  ])

  // 音声を合成
  const outputPath = path.join(jobDir, `lip-sync-multi-${randomUUID()}.mp4`)
  await runCommand('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    concatenatedVideoPath,
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

  // 中間ファイル削除
  await Promise.all([
    ...segmentVideoPaths.map((p) => fs.rm(p, { force: true })),
    fs.rm(concatListPath, { force: true }),
    fs.rm(concatenatedVideoPath, { force: true }),
  ])

  return {
    outputPath,
    durationMs: totalDurationMs,
  }
}

/**
 * タイムラインから指定範囲を抽出し、開始時刻を0に調整
 */
function extractAndAdjustTimeline(
  timeline: VisemeSegment[],
  startMs: number,
  endMs: number
): VisemeSegment[] {
  const extracted: VisemeSegment[] = []

  for (const segment of timeline) {
    // セグメントが範囲外なら無視
    if (segment.endMs <= startMs || segment.startMs >= endMs) {
      continue
    }

    // 範囲内に収まるように調整
    const adjustedStart = Math.max(segment.startMs, startMs) - startMs
    const adjustedEnd = Math.min(segment.endMs, endMs) - startMs

    extracted.push({
      startMs: adjustedStart,
      endMs: adjustedEnd,
      viseme: segment.viseme,
    })
  }

  return extracted
}

/**
 * フレームごとのオーバーレイ情報
 */
interface FrameOverlay {
  /** 出力フレーム番号 */
  frameIndex: number
  /** 開始時刻（秒） */
  startTime: number
  /** 終了時刻（秒） */
  endTime: number
  /** ビゼムタイプ */
  viseme: VisemeType
  /** 口画像のスケール後の幅 */
  width: number
  /** 口画像のスケール後の高さ */
  height: number
  /** オーバーレイX座標 */
  x: number
  /** オーバーレイY座標 */
  y: number
  /** 回転角度（ラジアン） */
  rotationRad: number
}

/**
 * FFmpegのフィルターグラフを構築
 * フレーム単位で口位置を追跡し、ベース動画の動きに追従する
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

  // 総時間を計算
  const totalDurationMs = timeline[timeline.length - 1].endMs
  const totalFrames = Math.ceil((totalDurationMs / 1000) * frameRate)

  // フレームごとのオーバーレイ情報を計算
  const frameOverlays = calculateFrameOverlays(
    timeline,
    mouthData,
    config,
    frameRate,
    totalFrames
  )

  // 隣接する同一設定のフレームを統合してセグメント化
  const segments = mergeFrameOverlays(frameOverlays)

  const filters: string[] = []
  let currentInput = '[0:v]'
  let outputCounter = 0

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const inputIdx = visemeInputIndex[seg.viseme]

    const scaleLabel = `[s${i}]`
    const outputLabel = `[v${outputCounter}]`

    // 口画像をスケーリング（+ 回転）
    let filterChain = `[${inputIdx}:v]scale=${seg.width}:${seg.height}`

    // 0.5度以上の回転がある場合のみ rotate フィルタを適用
    if (Math.abs(seg.rotationRad) > 0.00873) { // 約0.5度
      filterChain += `,format=rgba,rotate=${seg.rotationRad.toFixed(6)}:c=none:ow=rotw(${seg.rotationRad.toFixed(6)}):oh=roth(${seg.rotationRad.toFixed(6)})`
    }

    filters.push(`${filterChain}${scaleLabel}`)

    // オーバーレイ（時間条件付き）
    filters.push(
      `${currentInput}${scaleLabel}overlay=` +
        `x=${seg.x}:y=${seg.y}:` +
        `enable='between(t,${seg.startTime.toFixed(4)},${seg.endTime.toFixed(4)})'` +
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
 * 各フレームのオーバーレイ情報を計算
 */
function calculateFrameOverlays(
  timeline: VisemeSegment[],
  mouthData: MouthPositionData,
  config: ResolvedOverlayConfig,
  frameRate: number,
  totalFrames: number
): FrameOverlay[] {
  const overlays: FrameOverlay[] = []
  const frameDuration = 1 / frameRate

  // タイムラインをフレーム単位で検索しやすくするためのインデックス
  let timelineIdx = 0

  for (let frame = 0; frame < totalFrames; frame++) {
    const frameTime = frame * frameDuration
    const frameTimeMs = frameTime * 1000

    // このフレームに対応するビゼムを探す
    while (timelineIdx < timeline.length - 1 && timeline[timelineIdx].endMs <= frameTimeMs) {
      timelineIdx++
    }

    const segment = timeline[timelineIdx]
    if (!segment || frameTimeMs < segment.startMs) {
      // タイムライン外の場合はスキップ（通常は発生しない）
      continue
    }

    // このフレームの時刻に対応する口位置を取得
    const pos = getMouthPositionAtTime(mouthData, frameTime)

    // 口画像のサイズと位置を計算
    // 口画像は正方形を想定し、検出した口の幅に基づいて均等にスケーリング
    // （検出した口の高さは使用しない。高さは唇の開き具合で大きく変動するため）
    const targetSize = Math.round(pos.width * config.scale)
    const targetWidth = targetSize
    const targetHeight = targetSize
    const overlayX = Math.round(pos.centerX - targetWidth / 2 + config.offsetX)
    const overlayY = Math.round(pos.centerY - targetHeight / 2 + config.offsetY)

    const rotation = pos.rotation ?? 0
    const rotationRad = (rotation * Math.PI) / 180

    overlays.push({
      frameIndex: frame,
      startTime: frameTime,
      endTime: frameTime + frameDuration,
      viseme: segment.viseme,
      width: targetWidth,
      height: targetHeight,
      x: overlayX,
      y: overlayY,
      rotationRad,
    })
  }

  return overlays
}

/**
 * 隣接する同一設定のフレームを統合
 * フィルターグラフが長くなりすぎるのを防ぐ
 */
function mergeFrameOverlays(overlays: FrameOverlay[]): FrameOverlay[] {
  if (overlays.length === 0) return []

  const merged: FrameOverlay[] = []
  let current = { ...overlays[0] }

  for (let i = 1; i < overlays.length; i++) {
    const next = overlays[i]

    // 同じビゼム・同じ位置・同じサイズ・同じ回転なら統合
    const sameViseme = next.viseme === current.viseme
    const samePosition = next.x === current.x && next.y === current.y
    const sameSize = next.width === current.width && next.height === current.height
    const sameRotation = Math.abs(next.rotationRad - current.rotationRad) < 0.001

    if (sameViseme && samePosition && sameSize && sameRotation) {
      // 統合: 終了時刻を延長
      current.endTime = next.endTime
    } else {
      merged.push(current)
      current = { ...next }
    }
  }
  merged.push(current)

  return merged
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

