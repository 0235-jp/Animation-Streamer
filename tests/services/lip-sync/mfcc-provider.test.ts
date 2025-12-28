import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promises as fs } from 'node:fs'
import type { VisemeType } from '../../../src/types/generate'

// モックの設定
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
    },
  }
})

vi.mock('wav-decoder', () => ({
  default: {
    decode: vi.fn(),
  },
}))

vi.mock('meyda', () => ({
  default: {
    sampleRate: 16000,
    bufferSize: 1024,
    numberOfMFCCCoefficients: 13,
    extract: vi.fn(),
  },
}))

import wavDecoder from 'wav-decoder'
import Meyda from 'meyda'
import { MfccProvider } from '../../../src/services/lip-sync/mfcc-provider'

// profile.jsonのモックデータ
const mockProfile = {
  mfccNum: 12,
  melFilterBankChannels: 30,
  targetSampleRate: 16000,
  compareMethod: 2,
  mfccs: [
    {
      name: 'A',
      mfccCalibrationDataList: [
        { array: [100, 0, -65, -30, 5, 15, -33, 2, -10, -6, -12, -24] },
        { array: [100, 0, -65, -30, 5, 15, -33, 2, -10, -6, -12, -24] },
      ],
    },
    {
      name: 'I',
      mfccCalibrationDataList: [
        { array: [15, 50, 57, -34, -13, -16, -41, -12, -3, -9, 3, 1] },
        { array: [15, 50, 57, -34, -13, -16, -41, -12, -3, -9, 3, 1] },
      ],
    },
    {
      name: 'U',
      mfccCalibrationDataList: [
        { array: [100, 40, 28, 18, -15, -38, -37, 0, -4, -3, -5, 5] },
        { array: [100, 40, 28, 18, -15, -38, -37, 0, -4, -3, -5, 5] },
      ],
    },
    {
      name: 'E',
      mfccCalibrationDataList: [
        { array: [58, 10, 50, 6, -55, -16, -25, 4, -6, -3, 10, 1] },
        { array: [58, 10, 50, 6, -55, -16, -25, 4, -6, -3, 10, 1] },
      ],
    },
    {
      name: 'O',
      mfccCalibrationDataList: [
        { array: [108, 57, 0, -31, -38, -18, -11, -1, -1, -9, -2, -8] },
        { array: [108, 57, 0, -31, -38, -18, -11, -1, -1, -9, -2, -8] },
      ],
    },
    {
      name: 'N',
      mfccCalibrationDataList: [
        { array: [-94, 10, -20, 4, 2, -3, 12, -8, 10, -5, 2, 3] },
        { array: [-94, 10, -20, 4, 2, -3, 12, -8, 10, -5, 2, 3] },
      ],
    },
  ],
}

describe('MfccProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // profile.jsonのモック
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('profile.json')) {
        return JSON.stringify(mockProfile)
      }
      throw new Error(`Unexpected file read: ${path}`)
    })
  })

  describe('音素分類', () => {
    it('Aに近いMFCCをAに分類する', async () => {
      const provider = new MfccProvider()

      // Aに近いMFCC
      const aMfcc = [100, 0, -65, -30, 5, 15, -33, 2, -10, -6, -12, -24]

      // WAVファイルのモック
      const sampleRate = 16000
      const samples = new Float32Array(2048)
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('profile.json')) {
          return JSON.stringify(mockProfile)
        }
        return Buffer.from([])
      })
      vi.mocked(wavDecoder.decode).mockResolvedValue({
        sampleRate,
        channelData: [samples],
      })
      vi.mocked(Meyda.extract).mockReturnValue({
        mfcc: aMfcc,
        rms: 0.1, // 閾値以上
      })

      const segments = await provider.generateTimeline('test.wav')

      expect(segments.length).toBeGreaterThan(0)
      expect(segments[0].viseme).toBe('A')
    })

    it('Iに近いMFCCをIに分類する', async () => {
      const provider = new MfccProvider()

      // Iに近いMFCC
      const iMfcc = [15, 50, 57, -34, -13, -16, -41, -12, -3, -9, 3, 1]

      const sampleRate = 16000
      const samples = new Float32Array(2048)
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('profile.json')) {
          return JSON.stringify(mockProfile)
        }
        return Buffer.from([])
      })
      vi.mocked(wavDecoder.decode).mockResolvedValue({
        sampleRate,
        channelData: [samples],
      })
      vi.mocked(Meyda.extract).mockReturnValue({
        mfcc: iMfcc,
        rms: 0.1,
      })

      const segments = await provider.generateTimeline('test.wav')

      expect(segments.length).toBeGreaterThan(0)
      expect(segments[0].viseme).toBe('I')
    })

    it('Nに近いMFCCをNに分類する', async () => {
      const provider = new MfccProvider()

      // Nに近いMFCC
      const nMfcc = [-94, 10, -20, 4, 2, -3, 12, -8, 10, -5, 2, 3]

      const sampleRate = 16000
      const samples = new Float32Array(2048)
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('profile.json')) {
          return JSON.stringify(mockProfile)
        }
        return Buffer.from([])
      })
      vi.mocked(wavDecoder.decode).mockResolvedValue({
        sampleRate,
        channelData: [samples],
      })
      vi.mocked(Meyda.extract).mockReturnValue({
        mfcc: nMfcc,
        rms: 0.1,
      })

      const segments = await provider.generateTimeline('test.wav')

      expect(segments.length).toBeGreaterThan(0)
      expect(segments[0].viseme).toBe('N')
    })
  })

  describe('音量閾値', () => {
    it('RMSが閾値以下の場合、Nに分類する', async () => {
      const provider = new MfccProvider({ volumeThreshold: 0.005 })

      // Aに近いMFCC（だが音量が小さい）
      const aMfcc = [100, 0, -65, -30, 5, 15, -33, 2, -10, -6, -12, -24]

      const sampleRate = 16000
      const samples = new Float32Array(2048)
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('profile.json')) {
          return JSON.stringify(mockProfile)
        }
        return Buffer.from([])
      })
      vi.mocked(wavDecoder.decode).mockResolvedValue({
        sampleRate,
        channelData: [samples],
      })
      vi.mocked(Meyda.extract).mockReturnValue({
        mfcc: aMfcc,
        rms: 0.001, // 閾値以下
      })

      const segments = await provider.generateTimeline('test.wav')

      expect(segments.length).toBeGreaterThan(0)
      // 音量が閾値以下なのでNになる
      expect(segments[0].viseme).toBe('N')
    })

    it('カスタム音量閾値を設定できる', async () => {
      const provider = new MfccProvider({ volumeThreshold: 0.1 })

      const aMfcc = [100, 0, -65, -30, 5, 15, -33, 2, -10, -6, -12, -24]

      const sampleRate = 16000
      const samples = new Float32Array(2048)
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('profile.json')) {
          return JSON.stringify(mockProfile)
        }
        return Buffer.from([])
      })
      vi.mocked(wavDecoder.decode).mockResolvedValue({
        sampleRate,
        channelData: [samples],
      })
      vi.mocked(Meyda.extract).mockReturnValue({
        mfcc: aMfcc,
        rms: 0.05, // デフォルト閾値以上だがカスタム閾値以下
      })

      const segments = await provider.generateTimeline('test.wav')

      expect(segments[0].viseme).toBe('N')
    })
  })

  describe('セグメント変換', () => {
    it('連続する同じ音素を1つのセグメントに統合する', async () => {
      const provider = new MfccProvider()

      const sampleRate = 16000
      // 4フレーム分のサンプル
      const samples = new Float32Array(16000)
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('profile.json')) {
          return JSON.stringify(mockProfile)
        }
        return Buffer.from([])
      })
      vi.mocked(wavDecoder.decode).mockResolvedValue({
        sampleRate,
        channelData: [samples],
      })

      // 同じ音素を連続で返す
      const aMfcc = [100, 0, -65, -30, 5, 15, -33, 2, -10, -6, -12, -24]
      vi.mocked(Meyda.extract).mockReturnValue({
        mfcc: aMfcc,
        rms: 0.1,
      })

      const segments = await provider.generateTimeline('test.wav')

      // すべて同じ音素(A)なので1つのセグメントに統合される
      expect(segments.length).toBe(1)
      expect(segments[0].viseme).toBe('A')
    })

    it('異なる音素は別セグメントになる', async () => {
      const provider = new MfccProvider()

      const sampleRate = 16000
      const samples = new Float32Array(4096)
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('profile.json')) {
          return JSON.stringify(mockProfile)
        }
        return Buffer.from([])
      })
      vi.mocked(wavDecoder.decode).mockResolvedValue({
        sampleRate,
        channelData: [samples],
      })

      // 異なる音素を交互に返す
      const aMfcc = [100, 0, -65, -30, 5, 15, -33, 2, -10, -6, -12, -24]
      const iMfcc = [15, 50, 57, -34, -13, -16, -41, -12, -3, -9, 3, 1]

      let callCount = 0
      vi.mocked(Meyda.extract).mockImplementation(() => {
        callCount++
        return {
          mfcc: callCount % 2 === 1 ? aMfcc : iMfcc,
          rms: 0.1,
        }
      })

      const segments = await provider.generateTimeline('test.wav')

      // 異なる音素が交互に出るので複数セグメントになる
      expect(segments.length).toBeGreaterThan(1)
      const visemes = segments.map((s) => s.viseme)
      expect(visemes).toContain('A')
      expect(visemes).toContain('I')
    })
  })

  describe('タイムスタンプ計算', () => {
    it('正しい開始・終了時間を計算する', async () => {
      const provider = new MfccProvider({ frameSize: 1024, hopSize: 512 })

      const sampleRate = 16000
      // 2048サンプル = 2フレーム分
      const samples = new Float32Array(2048)
      vi.mocked(fs.readFile).mockImplementation(async (path) => {
        if (typeof path === 'string' && path.includes('profile.json')) {
          return JSON.stringify(mockProfile)
        }
        return Buffer.from([])
      })
      vi.mocked(wavDecoder.decode).mockResolvedValue({
        sampleRate,
        channelData: [samples],
      })

      const aMfcc = [100, 0, -65, -30, 5, 15, -33, 2, -10, -6, -12, -24]
      vi.mocked(Meyda.extract).mockReturnValue({
        mfcc: aMfcc,
        rms: 0.1,
      })

      const segments = await provider.generateTimeline('test.wav')

      expect(segments[0].startMs).toBe(0)
      // hopSize / sampleRate = 512 / 16000 = 0.032秒 = 32ms
      // 2フレーム: 0ms, 32ms → endMs = 32 + 32 = 64ms
      expect(segments[0].endMs).toBeGreaterThan(0)
    })
  })

  describe('オプション設定', () => {
    it('フレームサイズとホップサイズを設定できる', () => {
      const provider = new MfccProvider({
        frameSize: 2048,
        hopSize: 1024,
      })

      expect(provider).toBeInstanceOf(MfccProvider)
    })

    it('デフォルト値が適用される', () => {
      const provider = new MfccProvider()

      expect(provider).toBeInstanceOf(MfccProvider)
    })
  })
})

describe('ユークリッド距離', () => {
  // euclideanDistanceは内部関数なので、分類結果を通じて間接的にテスト

  it('同じMFCCベクトルは最も近い距離を示す', async () => {
    const provider = new MfccProvider()

    // プロファイルと完全に同じMFCC
    const exactAMfcc = [100, 0, -65, -30, 5, 15, -33, 2, -10, -6, -12, -24]

    const sampleRate = 16000
    const samples = new Float32Array(2048)
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('profile.json')) {
        return JSON.stringify(mockProfile)
      }
      return Buffer.from([])
    })
    vi.mocked(wavDecoder.decode).mockResolvedValue({
      sampleRate,
      channelData: [samples],
    })
    vi.mocked(Meyda.extract).mockReturnValue({
      mfcc: exactAMfcc,
      rms: 0.1,
    })

    const segments = await provider.generateTimeline('test.wav')

    expect(segments[0].viseme).toBe('A')
  })

  it('中間的なMFCCは最も近い音素に分類される', async () => {
    const provider = new MfccProvider()

    // AとIの中間だがAに近いMFCC
    const nearAMfcc = [90, 5, -60, -28, 4, 14, -32, 1, -9, -5, -10, -22]

    const sampleRate = 16000
    const samples = new Float32Array(2048)
    vi.mocked(fs.readFile).mockImplementation(async (path) => {
      if (typeof path === 'string' && path.includes('profile.json')) {
        return JSON.stringify(mockProfile)
      }
      return Buffer.from([])
    })
    vi.mocked(wavDecoder.decode).mockResolvedValue({
      sampleRate,
      channelData: [samples],
    })
    vi.mocked(Meyda.extract).mockReturnValue({
      mfcc: nearAMfcc,
      rms: 0.1,
    })

    const segments = await provider.generateTimeline('test.wav')

    // Aに最も近いのでAに分類される
    expect(segments[0].viseme).toBe('A')
  })
})
