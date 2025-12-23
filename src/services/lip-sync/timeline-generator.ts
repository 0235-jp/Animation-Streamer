import type { VoicevoxAudioQueryResponse, VisemeSegment, VisemeType } from '../../types/generate'

/**
 * VOICEVOX母音→aiueoNビゼムマッピング
 *
 * A: あ - 大きく開いた口
 * I: い - 横に広がった口
 * U: う - すぼめた口
 * E: え - 中間的に開いた口
 * O: お - 丸く開いた口
 * N: ん/無音 - 閉じた口
 */
const VOWEL_TO_VISEME: Record<string, VisemeType> = {
  a: 'A', // あ → 大きく開いた口
  i: 'I', // い → 横に広がった口
  u: 'U', // う → すぼめた口
  e: 'E', // え → 中間的に開いた口
  o: 'O', // お → 丸く開いた口
  N: 'N', // ん → 閉じた口
  cl: 'N', // 促音（っ）→ 閉じた口
  pau: 'N', // ポーズ → 閉じた口
}

/**
 * 子音→aiueoNビゼムマッピング
 * 子音は後続の母音に向かう過渡的な形状として、閉じた口（N）を使用
 */
const CONSONANT_TO_VISEME: Record<string, VisemeType> = {
  // すべての子音は閉じた口から始まる過渡的な形状
  m: 'N',
  b: 'N',
  p: 'N',
  f: 'N',
  r: 'N',
  k: 'N',
  s: 'N',
  t: 'N',
  n: 'N',
  h: 'N',
  y: 'N',
  w: 'N',
  g: 'N',
  z: 'N',
  d: 'N',
  j: 'N',
  ch: 'N',
  sh: 'N',
  ts: 'N',
  hy: 'N',
  ky: 'N',
  gy: 'N',
  ny: 'N',
  py: 'N',
  by: 'N',
  my: 'N',
  ry: 'N',
}

/**
 * VOICEVOX audio_queryのモーラ情報からビゼムタイムラインを生成
 * 子音と母音を別々のビゼムセグメントとして生成
 * speedScaleを考慮してタイミングを調整
 */
export function generateVisemeTimeline(audioQuery: VoicevoxAudioQueryResponse): VisemeSegment[] {
  const segments: VisemeSegment[] = []
  let currentTimeMs = 0

  // speedScaleでタイミングを調整（デフォルト1.0）
  const speedScale = audioQuery.speedScale || 1.0

  // prePhonemeLength（発話前の無音）を考慮
  const prePhonemeMs = (audioQuery.prePhonemeLength * 1000) / speedScale
  if (prePhonemeMs > 0) {
    segments.push({
      viseme: 'N',
      startMs: currentTimeMs,
      endMs: currentTimeMs + prePhonemeMs,
    })
    currentTimeMs += prePhonemeMs
  }

  for (const phrase of audioQuery.accent_phrases) {
    for (const mora of phrase.moras) {
      const consonantLengthSec = mora.consonant_length ?? 0
      const vowelLengthSec = mora.vowel_length

      // 子音がある場合、子音用のセグメントを追加
      if (consonantLengthSec > 0 && mora.consonant) {
        const consonantDurationMs = (consonantLengthSec * 1000) / speedScale
        const consonantViseme = mapConsonantToViseme(mora.consonant)
        if (consonantDurationMs > 0) {
          segments.push({
            viseme: consonantViseme,
            startMs: currentTimeMs,
            endMs: currentTimeMs + consonantDurationMs,
          })
          currentTimeMs += consonantDurationMs
        }
      }

      // 母音のセグメントを追加
      const vowelDurationMs = (vowelLengthSec * 1000) / speedScale
      const vowelViseme = mapVowelToViseme(mora.vowel)
      if (vowelDurationMs > 0) {
        segments.push({
          viseme: vowelViseme,
          startMs: currentTimeMs,
          endMs: currentTimeMs + vowelDurationMs,
        })
        currentTimeMs += vowelDurationMs
      }
    }

    // アクセント句の間のポーズ（pause_mora）
    if (phrase.pause_mora) {
      const pauseConsonantLength = phrase.pause_mora.consonant_length ?? 0
      const pauseTotalLength = pauseConsonantLength + phrase.pause_mora.vowel_length
      const pauseDurationMs = (pauseTotalLength * 1000) / speedScale
      if (pauseDurationMs > 0) {
        segments.push({
          viseme: 'N',
          startMs: currentTimeMs,
          endMs: currentTimeMs + pauseDurationMs,
        })
        currentTimeMs += pauseDurationMs
      }
    }
  }

  // postPhonemeLength（発話後の無音）を考慮
  const postPhonemeMs = (audioQuery.postPhonemeLength * 1000) / speedScale
  if (postPhonemeMs > 0) {
    segments.push({
      viseme: 'N',
      startMs: currentTimeMs,
      endMs: currentTimeMs + postPhonemeMs,
    })
    currentTimeMs += postPhonemeMs
  }

  // 最後が N（閉じた口）でない場合は、1フレーム分の N を追加
  const lastSegment = segments[segments.length - 1]
  if (lastSegment && lastSegment.viseme !== 'N') {
    const oneFrameMs = 34 // 約1フレーム（30fps）
    segments.push({
      viseme: 'N',
      startMs: currentTimeMs,
      endMs: currentTimeMs + oneFrameMs,
    })
  }

  // 隣接する同じビゼムのセグメントを統合
  return mergeAdjacentSegments(segments)
}

/**
 * 母音文字列をビゼムタイプに変換
 */
function mapVowelToViseme(vowel: string): VisemeType {
  const viseme = VOWEL_TO_VISEME[vowel]
  if (viseme) {
    return viseme
  }
  // 未知の母音はNにフォールバック（閉じた口）
  return 'N'
}

/**
 * 子音文字列をビゼムタイプに変換
 */
function mapConsonantToViseme(consonant: string): VisemeType {
  const viseme = CONSONANT_TO_VISEME[consonant]
  if (viseme) {
    return viseme
  }
  // 未知の子音はNにフォールバック（閉じた口）
  return 'N'
}

/**
 * 隣接する同じビゼムのセグメントを統合
 */
function mergeAdjacentSegments(segments: VisemeSegment[]): VisemeSegment[] {
  if (segments.length === 0) {
    return []
  }

  const merged: VisemeSegment[] = []
  let current = { ...segments[0] }

  for (let i = 1; i < segments.length; i++) {
    const segment = segments[i]
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

/**
 * タイムラインの総時間を取得（ミリ秒）
 */
export function getTimelineDurationMs(segments: VisemeSegment[]): number {
  if (segments.length === 0) {
    return 0
  }
  return segments[segments.length - 1].endMs
}
