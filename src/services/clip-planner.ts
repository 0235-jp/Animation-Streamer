import {
  ResolvedAction,
  ResolvedIdleMotion,
  ResolvedSpeechMotion,
  type ResolvedIdlePools,
  type ResolvedSpeechPools,
  type ResolvedSpeechTransitions,
  type ResolvedTransitionMotion,
} from '../config/loader'
import type { ClipSource, MediaPipeline } from './media-pipeline'

interface ClipCandidate {
  motion: ResolvedIdleMotion
  durationMs: number
}

export interface ClipPlanResult {
  clips: ClipSource[]
  totalDurationMs: number
  motionIds: string[]
  talkDurationMs?: number
  enterDurationMs?: number
  exitDurationMs?: number
}

const EPSILON_MS = 50

const normalizeEmotion = (value?: string) => value?.trim().toLowerCase()

export class ClipPlanner {
  private readonly speechPools: Map<
    string,
    {
      large: ResolvedSpeechMotion[]
      small: ResolvedSpeechMotion[]
    }
  >
  private readonly idleLarge: ResolvedIdleMotion[]
  private readonly idleSmall: ResolvedIdleMotion[]
  private readonly speechEnterTransition?: ResolvedTransitionMotion
  private readonly speechExitTransition?: ResolvedTransitionMotion

  constructor(
    private readonly mediaPipeline: MediaPipeline,
    speechPools: ResolvedSpeechPools,
    idlePools: ResolvedIdlePools,
    speechTransitions?: ResolvedSpeechTransitions
  ) {
    this.speechPools = this.buildSpeechPools(speechPools)
    this.idleLarge = idlePools.large
    this.idleSmall = idlePools.small
    this.speechEnterTransition = speechTransitions?.enter
    this.speechExitTransition = speechTransitions?.exit
  }

  async buildSpeechPlan(emotion: string | undefined, durationMs: number): Promise<ClipPlanResult> {
    const normalizedEmotion = normalizeEmotion(emotion)
    const corePlan = await this.buildSpeechCorePlan(normalizedEmotion, durationMs)

    const clips = [...corePlan.clips]
    const motionIds = [...corePlan.motionIds]
    let totalDuration = corePlan.totalDurationMs
    let enterDurationMs: number | undefined
    let exitDurationMs: number | undefined

    if (this.speechEnterTransition && this.matchesEmotion(this.speechEnterTransition.emotion, normalizedEmotion)) {
      const enterClip = await this.buildTransitionClip(this.speechEnterTransition)
      clips.unshift(enterClip)
      motionIds.unshift(enterClip.id)
      totalDuration += enterClip.durationMs
      enterDurationMs = enterClip.durationMs
    }

    if (this.speechExitTransition && this.matchesEmotion(this.speechExitTransition.emotion, normalizedEmotion)) {
      const exitClip = await this.buildTransitionClip(this.speechExitTransition)
      clips.push(exitClip)
      motionIds.push(exitClip.id)
      totalDuration += exitClip.durationMs
      exitDurationMs = exitClip.durationMs
    }

    return {
      clips,
      totalDurationMs: totalDuration,
      motionIds,
      talkDurationMs: corePlan.totalDurationMs,
      enterDurationMs,
      exitDurationMs,
    }
  }

  private async buildSpeechCorePlan(normalizedEmotion: string | undefined, durationMs: number): Promise<ClipPlanResult> {
    const pool =
      (normalizedEmotion && this.speechPools.get(normalizedEmotion)) ??
      this.speechPools.get('neutral') ??
      [...this.speechPools.values()][0]
    if (!pool) {
      throw new Error('speechMotions が設定されていません')
    }
    return this.fillPlan(durationMs, pool.large, pool.small)
  }

  async buildIdlePlan(durationMs: number, motionId?: string, emotion?: string): Promise<ClipPlanResult> {
    const normalizedEmotion = normalizeEmotion(emotion)
    if (motionId) {
      const motion = [...this.idleLarge, ...this.idleSmall].find((m) => m.id === motionId)
      if (!motion) {
        throw new Error(`待機モーション ${motionId} が見つかりません`)
      }
      return this.repeatSingleMotion(motion, durationMs)
    }
    const filteredLarge = normalizedEmotion
      ? this.idleLarge.filter((motion) => motion.emotion === normalizedEmotion)
      : this.idleLarge
    const filteredSmall = normalizedEmotion
      ? this.idleSmall.filter((motion) => motion.emotion === normalizedEmotion)
      : this.idleSmall
    const fallbackEmotionLarge = filteredLarge.length ? filteredLarge : this.idleLarge
    const fallbackEmotionSmall = filteredSmall.length ? filteredSmall : this.idleSmall
    return this.fillPlan(durationMs, fallbackEmotionLarge, fallbackEmotionSmall)
  }

  async buildActionClip(action: ResolvedAction): Promise<ClipPlanResult> {
    const durationMs = await this.mediaPipeline.getVideoDurationMs(action.absolutePath)
    const clip: ClipSource = {
      id: action.id,
      path: action.absolutePath,
      durationMs,
    }
    return {
      clips: [clip],
      totalDurationMs: durationMs,
      motionIds: [action.id],
    }
  }

  private buildSpeechPools(pools: ResolvedSpeechPools) {
    const speechMap = new Map<
      string,
      {
        large: ResolvedSpeechMotion[]
        small: ResolvedSpeechMotion[]
      }
    >()
    const addMotion = (motion: ResolvedSpeechMotion) => {
      const emotion = normalizeEmotion(motion.emotion) ?? 'neutral'
      if (!speechMap.has(emotion)) {
        speechMap.set(emotion, { large: [], small: [] })
      }
      const bucket = speechMap.get(emotion)!
      bucket[motion.type === 'large' ? 'large' : 'small'].push(motion)
    }
    pools.large.forEach(addMotion)
    pools.small.forEach(addMotion)
    return speechMap
  }

  private async repeatSingleMotion(motion: ResolvedIdleMotion, durationMs: number): Promise<ClipPlanResult> {
    const duration = await this.mediaPipeline.getVideoDurationMs(motion.absolutePath)
    if (duration <= EPSILON_MS) {
      throw new Error(`モーション ${motion.id} の長さが短すぎます`)
    }
    const clip: ClipSource = {
      id: motion.id,
      path: motion.absolutePath,
      durationMs: duration,
    }
    const clips: ClipSource[] = []
    let covered = 0
    while (covered + EPSILON_MS < durationMs || !clips.length) {
      clips.push({ ...clip })
      covered += duration
      if (clips.length > 1000) break
    }
    return {
      clips,
      totalDurationMs: covered,
      motionIds: clips.map((c) => c.id),
    }
  }

  private async fillPlan(
    targetDurationMs: number,
    largeMotions: ResolvedIdleMotion[],
    smallMotions: ResolvedIdleMotion[]
  ): Promise<ClipPlanResult> {
    if (!largeMotions.length && !smallMotions.length) {
      throw new Error('利用可能なモーションがありません')
    }
    const largeCandidates = await this.buildCandidates(largeMotions)
    const smallCandidates = await this.buildCandidates(smallMotions)

    const plan: ClipSource[] = []
    let covered = 0
    let iterations = 0
    const maxIterations = 2000

    while (covered + EPSILON_MS < targetDurationMs && iterations < maxIterations) {
      iterations++
      const remaining = targetDurationMs - covered
      const candidate =
        this.pickCandidate(largeCandidates, remaining) ??
        this.pickCandidate(smallCandidates, remaining) ??
        this.pickAnyCandidate(smallCandidates) ??
        this.pickAnyCandidate(largeCandidates)

      if (!candidate) {
        break
      }
      plan.push({
        id: candidate.motion.id,
        path: candidate.motion.absolutePath,
        durationMs: candidate.durationMs,
      })
      covered += candidate.durationMs
    }

    const ensureFallback = () => {
      const fallback = this.pickAnyCandidate(largeCandidates) ?? this.pickAnyCandidate(smallCandidates)
      if (!fallback) {
        throw new Error('モーションの選択に失敗しました')
      }
      plan.push({
        id: fallback.motion.id,
        path: fallback.motion.absolutePath,
        durationMs: fallback.durationMs,
      })
      covered += fallback.durationMs
    }

    if (!plan.length) {
      ensureFallback()
    }
    while (covered + EPSILON_MS < targetDurationMs) {
      ensureFallback()
      if (plan.length > maxIterations) break
    }

    return {
      clips: plan,
      totalDurationMs: covered,
      motionIds: plan.map((clip) => clip.id),
    }
  }

  private async buildCandidates(motions: ResolvedIdleMotion[]): Promise<ClipCandidate[]> {
    return Promise.all(
      motions.map(async (motion) => {
        const durationMs = await this.mediaPipeline.getVideoDurationMs(motion.absolutePath)
        if (durationMs <= 0) {
          throw new Error(`モーション ${motion.id} の長さが取得できませんでした`)
        }
        return {
          motion,
          durationMs,
        }
      })
    )
  }

  private pickCandidate(candidates: ClipCandidate[], remainingMs: number): ClipCandidate | null {
    const filtered = candidates.filter((candidate) => candidate.durationMs <= remainingMs + EPSILON_MS)
    if (!filtered.length) return null
    return filtered[Math.floor(Math.random() * filtered.length)]
  }

  private pickAnyCandidate(candidates: ClipCandidate[]): ClipCandidate | null {
    if (!candidates.length) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }

  private async buildTransitionClip(motion: ResolvedTransitionMotion): Promise<ClipSource> {
    const durationMs = await this.mediaPipeline.getVideoDurationMs(motion.absolutePath)
    if (durationMs <= EPSILON_MS) {
      throw new Error(`トランジションモーション ${motion.id} の長さが短すぎます`)
    }
    return {
      id: motion.id,
      path: motion.absolutePath,
      durationMs,
    }
  }

  private matchesEmotion(transitionEmotion: string | undefined, targetEmotion?: string | null) {
    const normalizedTransition = transitionEmotion?.trim().toLowerCase() || 'neutral'
    const normalizedTarget = targetEmotion?.trim().toLowerCase()
    if (!normalizedTarget) {
      return normalizedTransition === 'neutral'
    }
    return normalizedTransition === normalizedTarget
  }
}
