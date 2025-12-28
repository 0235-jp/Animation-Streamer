import { describe, it, expect } from 'vitest'
import {
  generateVisemeTimeline,
  getTimelineDurationMs,
} from '../../../src/services/lip-sync/timeline-generator'
import type { VoicevoxAudioQueryResponse } from '../../../src/types/generate'

/**
 * テスト用のaudio_queryを作成するヘルパー
 */
function createAudioQuery(
  overrides: Partial<VoicevoxAudioQueryResponse> = {}
): VoicevoxAudioQueryResponse {
  return {
    accent_phrases: [],
    speedScale: 1.0,
    pitchScale: 1.0,
    intonationScale: 1.0,
    volumeScale: 1.0,
    prePhonemeLength: 0,
    postPhonemeLength: 0,
    outputSamplingRate: 24000,
    outputStereo: false,
    ...overrides,
  }
}

describe('generateVisemeTimeline', () => {
  describe('母音マッピング', () => {
    it.each([
      ['a', 'A'],
      ['i', 'I'],
      ['u', 'U'],
      ['e', 'E'],
      ['o', 'O'],
      ['N', 'N'],
    ])('母音 %s を ビゼム %s に変換する', (vowel, expectedViseme) => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'あ', vowel, vowel_length: 0.1, pitch: 5.0 }],
            accent: 1,
          },
        ],
      })

      const segments = generateVisemeTimeline(audioQuery)

      // 末尾のNセグメントを除外して母音セグメントを確認
      const vowelSegment = segments.find((s) => s.viseme === expectedViseme)
      expect(vowelSegment).toBeDefined()
    })

    it('促音(cl)をNに変換する', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'っ', vowel: 'cl', vowel_length: 0.05, pitch: 0 }],
            accent: 1,
          },
        ],
      })

      const segments = generateVisemeTimeline(audioQuery)

      expect(segments.every((s) => s.viseme === 'N')).toBe(true)
    })

    it('未知の母音をNにフォールバックする', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'x', vowel: 'unknown', vowel_length: 0.1, pitch: 5.0 }],
            accent: 1,
          },
        ],
      })

      const segments = generateVisemeTimeline(audioQuery)

      expect(segments.every((s) => s.viseme === 'N')).toBe(true)
    })
  })

  describe('子音マッピング', () => {
    it.each(['m', 'b', 'p', 'k', 's', 't', 'n', 'h', 'r', 'y', 'w', 'g', 'z', 'd', 'j'])(
      '子音 %s をNに変換する',
      (consonant) => {
        const audioQuery = createAudioQuery({
          accent_phrases: [
            {
              moras: [
                {
                  text: 'か',
                  consonant,
                  consonant_length: 0.05,
                  vowel: 'a',
                  vowel_length: 0.1,
                  pitch: 5.0,
                },
              ],
              accent: 1,
            },
          ],
        })

        const segments = generateVisemeTimeline(audioQuery)

        // 子音セグメントはN
        const consonantSegment = segments[0]
        expect(consonantSegment.viseme).toBe('N')
      }
    )

    it.each(['ch', 'sh', 'ts', 'hy', 'ky', 'gy', 'ny', 'py', 'by', 'my', 'ry'])(
      '複合子音 %s をNに変換する',
      (consonant) => {
        const audioQuery = createAudioQuery({
          accent_phrases: [
            {
              moras: [
                {
                  text: 'ちゃ',
                  consonant,
                  consonant_length: 0.05,
                  vowel: 'a',
                  vowel_length: 0.1,
                  pitch: 5.0,
                },
              ],
              accent: 1,
            },
          ],
        })

        const segments = generateVisemeTimeline(audioQuery)

        const consonantSegment = segments[0]
        expect(consonantSegment.viseme).toBe('N')
      }
    )
  })

  describe('speedScale', () => {
    it('speedScale=1.0で元のタイミングを維持する', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'あ', vowel: 'a', vowel_length: 0.1, pitch: 5.0 }],
            accent: 1,
          },
        ],
        speedScale: 1.0,
      })

      const segments = generateVisemeTimeline(audioQuery)

      const vowelSegment = segments.find((s) => s.viseme === 'A')
      expect(vowelSegment).toBeDefined()
      expect(vowelSegment!.endMs - vowelSegment!.startMs).toBe(100)
    })

    it('speedScale=2.0でタイムラインが半分の長さになる', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'あ', vowel: 'a', vowel_length: 0.2, pitch: 5.0 }],
            accent: 1,
          },
        ],
        speedScale: 2.0,
      })

      const segments = generateVisemeTimeline(audioQuery)

      const vowelSegment = segments.find((s) => s.viseme === 'A')
      expect(vowelSegment).toBeDefined()
      // 0.2秒 / 2.0 = 0.1秒 = 100ms
      expect(vowelSegment!.endMs - vowelSegment!.startMs).toBe(100)
    })

    it('speedScale=0.5でタイムラインが2倍の長さになる', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'あ', vowel: 'a', vowel_length: 0.1, pitch: 5.0 }],
            accent: 1,
          },
        ],
        speedScale: 0.5,
      })

      const segments = generateVisemeTimeline(audioQuery)

      const vowelSegment = segments.find((s) => s.viseme === 'A')
      expect(vowelSegment).toBeDefined()
      // 0.1秒 / 0.5 = 0.2秒 = 200ms
      expect(vowelSegment!.endMs - vowelSegment!.startMs).toBe(200)
    })
  })

  describe('prePhonemeLength / postPhonemeLength', () => {
    it('prePhoneLengthの無音を先頭に追加する', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'あ', vowel: 'a', vowel_length: 0.1, pitch: 5.0 }],
            accent: 1,
          },
        ],
        prePhonemeLength: 0.1,
      })

      const segments = generateVisemeTimeline(audioQuery)

      expect(segments[0].viseme).toBe('N')
      expect(segments[0].startMs).toBe(0)
      expect(segments[0].endMs).toBe(100)
    })

    it('postPhoneLengthの無音を末尾に追加する', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'あ', vowel: 'a', vowel_length: 0.1, pitch: 5.0 }],
            accent: 1,
          },
        ],
        postPhonemeLength: 0.1,
      })

      const segments = generateVisemeTimeline(audioQuery)

      const lastSegment = segments[segments.length - 1]
      expect(lastSegment.viseme).toBe('N')
    })
  })

  describe('pause_mora', () => {
    it('アクセント句間のポーズをNとして挿入する', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'あ', vowel: 'a', vowel_length: 0.1, pitch: 5.0 }],
            accent: 1,
            pause_mora: { text: '、', vowel: 'pau', vowel_length: 0.3, pitch: 0 },
          },
          {
            moras: [{ text: 'い', vowel: 'i', vowel_length: 0.1, pitch: 5.0 }],
            accent: 1,
          },
        ],
      })

      const segments = generateVisemeTimeline(audioQuery)

      // A -> N(pause) -> I の順になるはず
      const visemes = segments.map((s) => s.viseme)
      expect(visemes).toContain('A')
      expect(visemes).toContain('I')
      // ポーズ用のNが含まれる
      const pauseSegment = segments.find(
        (s, i) => s.viseme === 'N' && i > 0 && segments[i - 1]?.viseme === 'A'
      )
      expect(pauseSegment).toBeDefined()
    })
  })

  describe('セグメント統合', () => {
    it('連続する同じビゼムを1つのセグメントに統合する', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [
              { text: 'ん', vowel: 'N', vowel_length: 0.1, pitch: 0 },
              { text: 'っ', vowel: 'cl', vowel_length: 0.05, pitch: 0 },
            ],
            accent: 1,
          },
        ],
      })

      const segments = generateVisemeTimeline(audioQuery)

      // N, cl(=N) が統合されて1つのNセグメントになる
      expect(segments.length).toBe(1)
      expect(segments[0].viseme).toBe('N')
      expect(segments[0].endMs - segments[0].startMs).toBe(150)
    })
  })

  describe('末尾Nの追加', () => {
    it('最後が母音で終わる場合、1フレーム分のNを追加する', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [{ text: 'あ', vowel: 'a', vowel_length: 0.1, pitch: 5.0 }],
            accent: 1,
          },
        ],
      })

      const segments = generateVisemeTimeline(audioQuery)

      const lastSegment = segments[segments.length - 1]
      expect(lastSegment.viseme).toBe('N')
    })
  })

  describe('空のaudio_query', () => {
    it('accent_phrasesが空の場合、空のタイムラインを返す', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [],
      })

      const segments = generateVisemeTimeline(audioQuery)

      expect(segments).toEqual([])
    })
  })

  describe('複合テスト: こんにちは', () => {
    it('「こんにちは」を正しく変換する', () => {
      const audioQuery = createAudioQuery({
        accent_phrases: [
          {
            moras: [
              { text: 'こ', consonant: 'k', consonant_length: 0.05, vowel: 'o', vowel_length: 0.1, pitch: 5.0 },
              { text: 'ん', vowel: 'N', vowel_length: 0.08, pitch: 5.0 },
              { text: 'に', consonant: 'n', consonant_length: 0.04, vowel: 'i', vowel_length: 0.1, pitch: 5.0 },
              { text: 'ち', consonant: 'ch', consonant_length: 0.05, vowel: 'i', vowel_length: 0.1, pitch: 5.0 },
              { text: 'は', consonant: 'h', consonant_length: 0.03, vowel: 'a', vowel_length: 0.15, pitch: 5.0 },
            ],
            accent: 3,
          },
        ],
        speedScale: 1.0,
      })

      const segments = generateVisemeTimeline(audioQuery)

      // 期待されるビゼムシーケンス: N(k) -> O(o) -> N(ん) -> N(n) -> I(i) -> N(ch) -> I(i) -> N(h) -> A(a) -> N(末尾)
      // 隣接するNは統合される
      const visemeSequence = segments.map((s) => s.viseme)

      // こ: k(N) + o(O)
      expect(visemeSequence).toContain('O')
      // に, ち: I
      expect(visemeSequence).toContain('I')
      // は: A
      expect(visemeSequence).toContain('A')
      // 末尾はN
      expect(visemeSequence[visemeSequence.length - 1]).toBe('N')
    })
  })
})

describe('getTimelineDurationMs', () => {
  it('空のタイムラインは0msを返す', () => {
    expect(getTimelineDurationMs([])).toBe(0)
  })

  it('タイムラインの総時間を返す', () => {
    const segments = [
      { viseme: 'A' as const, startMs: 0, endMs: 100 },
      { viseme: 'I' as const, startMs: 100, endMs: 200 },
      { viseme: 'N' as const, startMs: 200, endMs: 300 },
    ]

    expect(getTimelineDurationMs(segments)).toBe(300)
  })
})
