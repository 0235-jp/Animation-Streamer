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

/**
 * 口の位置情報（フレーム単位）
 * Pythonスクリプト（detect_mouth_positions.py）の出力形式
 */
export interface MouthPosition {
  /** フレーム番号 */
  frameIndex: number
  /** 口の中心X座標 */
  centerX: number
  /** 口の中心Y座標 */
  centerY: number
  /** 口の幅 */
  width: number
  /** 口の高さ */
  height: number
  /** 顔の回転角度（度数法）、正の値は時計回り */
  rotation?: number
}

/**
 * 動画の口位置データ（JSON出力形式）
 */
export interface MouthPositionData {
  /** 動画の幅 */
  videoWidth: number
  /** 動画の高さ */
  videoHeight: number
  /** フレームレート */
  frameRate: number
  /** 総フレーム数 */
  totalFrames: number
  /** 各フレームの口位置 */
  positions: MouthPosition[]
}

/**
 * 口画像オーバーレイ設定
 */
export interface MouthOverlayConfig {
  /** 口画像のスケール倍率（検出した口サイズに対する比率） */
  scale: number
  /** X軸オフセット（ピクセル） */
  offsetX: number
  /** Y軸オフセット（ピクセル） */
  offsetY: number
}
