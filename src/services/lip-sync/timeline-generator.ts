import type { VoicevoxAudioQueryResponse, VisemeSegment, VisemeType } from '../../types/generate'

/**
 * VOICEVOX母音→ビゼムマッピング
 */
const VOWEL_TO_VISEME: Record<string, VisemeType> = {
  a: 'a',
  i: 'i',
  u: 'u',
  e: 'e',
  o: 'o',
  N: 'N', // ん
  cl: 'closed', // 促音（っ）
  pau: 'closed', // ポーズ
}

/**
 * VOICEVOX audio_queryのモーラ情報からビゼムタイムラインを生成
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
      viseme: 'closed',
      startMs: currentTimeMs,
      endMs: currentTimeMs + prePhonemeMs,
    })
    currentTimeMs += prePhonemeMs
  }

  for (const phrase of audioQuery.accent_phrases) {
    for (const mora of phrase.moras) {
      // モーラの長さ = 子音の長さ + 母音の長さ
      const consonantLength = mora.consonant_length ?? 0
      const totalLengthSec = consonantLength + mora.vowel_length
      const durationMs = (totalLengthSec * 1000) / speedScale
      const viseme = mapVowelToViseme(mora.vowel)

      if (durationMs > 0) {
        segments.push({
          viseme,
          startMs: currentTimeMs,
          endMs: currentTimeMs + durationMs,
        })
        currentTimeMs += durationMs
      }
    }

    // アクセント句の間のポーズ（pause_mora）
    if (phrase.pause_mora) {
      const pauseConsonantLength = phrase.pause_mora.consonant_length ?? 0
      const pauseTotalLength = pauseConsonantLength + phrase.pause_mora.vowel_length
      const pauseDurationMs = (pauseTotalLength * 1000) / speedScale
      if (pauseDurationMs > 0) {
        segments.push({
          viseme: 'closed',
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
      viseme: 'closed',
      startMs: currentTimeMs,
      endMs: currentTimeMs + postPhonemeMs,
    })
    currentTimeMs += postPhonemeMs
  }

  // 最後が closed でない場合は、1フレーム分の closed を追加
  const lastSegment = segments[segments.length - 1]
  if (lastSegment && lastSegment.viseme !== 'closed') {
    const oneFrameMs = 34 // 約1フレーム（30fps）
    segments.push({
      viseme: 'closed',
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
  // 未知の母音はclosedにフォールバック
  return 'closed'
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
