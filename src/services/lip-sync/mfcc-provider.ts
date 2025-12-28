import { promises as fs } from 'node:fs'
import path from 'node:path'
import Meyda from 'meyda'
import wavDecoder from 'wav-decoder'
import type { VisemeSegment, VisemeType } from '../../types/generate'
import type { LipSyncProvider, MfccProfile } from './types'

// プロファイルデータの読み込み
const profilePath = path.join(__dirname, 'profile.json')

interface PhonemeProfile {
  name: VisemeType
  avgMFCC: number[]
}

/**
 * キャリブレーションデータから平均MFCCを計算
 */
function computeAverageMFCC(calibrationDataList: { array: number[] }[]): number[] {
  const mfccArrays = calibrationDataList.map((d) => d.array)
  const avgMFCC: number[] = []
  const mfccLength = mfccArrays[0].length

  for (let i = 0; i < mfccLength; i++) {
    let sum = 0
    for (const arr of mfccArrays) {
      sum += arr[i]
    }
    avgMFCC.push(sum / mfccArrays.length)
  }
  return avgMFCC
}

/**
 * 2つのMFCCベクトル間のユークリッド距離を計算
 */
function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    sum += (a[i] - b[i]) ** 2
  }
  return Math.sqrt(sum)
}

/**
 * MFCC（メル周波数ケプストラム係数）ベースのリップシンクプロバイダー
 * LipWI2VJs / wLipSync の手法を使用
 */
export class MfccProvider implements LipSyncProvider {
  private phonemeProfiles: PhonemeProfile[] = []
  private initialized = false
  private readonly volumeThreshold: number
  private readonly frameSize: number
  private readonly hopSize: number

  constructor(options?: { volumeThreshold?: number; frameSize?: number; hopSize?: number }) {
    this.volumeThreshold = options?.volumeThreshold ?? 0.005
    this.frameSize = options?.frameSize ?? 1024
    this.hopSize = options?.hopSize ?? 512
  }

  /**
   * プロファイルを読み込んで初期化
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return

    const raw = await fs.readFile(profilePath, 'utf8')
    const profile = JSON.parse(raw) as MfccProfile

    this.phonemeProfiles = profile.mfccs.map((p) => ({
      name: p.name,
      avgMFCC: computeAverageMFCC(p.mfccCalibrationDataList),
    }))

    this.initialized = true
  }

  /**
   * MFCCから最も近い音素を分類
   */
  private classifyPhoneme(mfcc: number[]): VisemeType {
    let bestPhoneme: VisemeType = 'N'
    let minDistance = Infinity

    for (const p of this.phonemeProfiles) {
      const dist = euclideanDistance(mfcc, p.avgMFCC)
      if (dist < minDistance) {
        minDistance = dist
        bestPhoneme = p.name
      }
    }

    return bestPhoneme
  }

  /**
   * 音声ファイルからビゼムタイムラインを生成
   * @param audioPath 音声ファイルパス（WAV形式）
   * @returns ビゼムタイムライン
   */
  async generateTimeline(audioPath: string): Promise<VisemeSegment[]> {
    await this.initialize()

    // WAVファイルを読み込み
    const buffer = await fs.readFile(audioPath)
    const audioData = await wavDecoder.decode(buffer)

    const samples = audioData.channelData[0]
    const sampleRate = audioData.sampleRate

    // Meydaの設定
    Meyda.sampleRate = sampleRate
    Meyda.bufferSize = this.frameSize
    Meyda.numberOfMFCCCoefficients = 13

    const frames: { time: number; phoneme: VisemeType }[] = []

    // 各フレームを解析
    for (let i = 0; i + this.frameSize < samples.length; i += this.hopSize) {
      const frame = new Float32Array(samples.slice(i, i + this.frameSize))
      const time = i / sampleRate

      const features = Meyda.extract(['mfcc', 'rms'], frame) as {
        mfcc?: number[]
        rms?: number
      } | null

      if (features?.mfcc) {
        const rms = features.rms ?? 0
        const mfcc = features.mfcc.slice(0, 12)

        // 音量が閾値以下なら閉じた口（N）
        const phoneme = rms > this.volumeThreshold ? this.classifyPhoneme(mfcc) : 'N'

        frames.push({ time, phoneme })
      }
    }

    // フレームデータをVisemeSegmentに変換
    return this.framesToSegments(frames)
  }

  /**
   * フレームデータをVisemeSegmentに変換
   * 連続する同じ音素をマージ
   */
  private framesToSegments(frames: { time: number; phoneme: VisemeType }[]): VisemeSegment[] {
    if (frames.length === 0) return []

    const segments: VisemeSegment[] = []
    let currentPhoneme = frames[0].phoneme
    let startTime = frames[0].time

    for (let i = 1; i < frames.length; i++) {
      const frame = frames[i]
      if (frame.phoneme !== currentPhoneme) {
        segments.push({
          viseme: currentPhoneme,
          startMs: Math.round(startTime * 1000),
          endMs: Math.round(frame.time * 1000),
        })
        currentPhoneme = frame.phoneme
        startTime = frame.time
      }
    }

    // 最後のセグメント
    const lastFrame = frames[frames.length - 1]
    const frameDurationSec = this.hopSize / Meyda.sampleRate
    segments.push({
      viseme: currentPhoneme,
      startMs: Math.round(startTime * 1000),
      endMs: Math.round((lastFrame.time + frameDurationSec) * 1000),
    })

    return segments
  }
}

/**
 * デフォルトの MFCC プロバイダーインスタンス
 */
let defaultProvider: MfccProvider | null = null

export function getMfccProvider(): MfccProvider {
  if (!defaultProvider) {
    defaultProvider = new MfccProvider()
  }
  return defaultProvider
}
