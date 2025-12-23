import type { VisemeSegment, VisemeType } from '../../types/generate'

/**
 * リップシンクプロバイダーインターフェース
 * 音声ファイルからビゼムタイムラインを生成する
 */
export interface LipSyncProvider {
  /**
   * 音声ファイルからビゼムタイムラインを生成
   * @param audioPath 音声ファイルパス（WAV形式）
   * @returns ビゼムタイムライン
   */
  generateTimeline(audioPath: string): Promise<VisemeSegment[]>
}

/**
 * MFCC解析の出力形式（フレーム単位）
 */
export interface MfccFrame {
  time: number // 秒
  phoneme: VisemeType
  rms: number // 音量
}

/**
 * MFCC解析の結果
 */
export interface MfccAnalysisResult {
  audioPath: string
  sampleRate: number
  duration: number
  frameCount: number
  hopSize: number
  frames: MfccFrame[]
}

/**
 * MFCCプロファイル（母音のキャリブレーションデータ）
 */
export interface MfccProfile {
  mfccNum: number
  melFilterBankChannels: number
  targetSampleRate: number
  compareMethod: number
  mfccs: MfccPhonemeData[]
}

export interface MfccPhonemeData {
  name: VisemeType
  mfccCalibrationDataList: MfccCalibrationData[]
}

export interface MfccCalibrationData {
  array: number[]
}
