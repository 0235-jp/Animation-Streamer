import {
  ResolvedAction,
  ResolvedIdleMotion,
  ResolvedPreset,
  ResolvedSpeechMotion,
  type ResolvedSpeechPools,
  type ResolvedTransitionMotion,
} from '../config/loader'
import type { ClipSource, MediaPipeline, VideoSpec } from './media-pipeline'
import { logger } from '../utils/logger'

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
const MAX_REPEAT_CLIPS = 1000 // prevent runaway loops when repeating a single clip for long durations

const normalizeEmotion = (value?: string) => value?.trim().toLowerCase()

interface PresetClipResources {
  speechPools: Map<
    string,
    {
      large: ResolvedSpeechMotion[]
      small: ResolvedSpeechMotion[]
    }
  >
  idleLarge: ResolvedIdleMotion[]
  idleSmall: ResolvedIdleMotion[]
  speechEnterTransitions?: Map<string, ResolvedTransitionMotion[]>
  speechExitTransitions?: Map<string, ResolvedTransitionMotion[]>
}

interface MotionSpecEntry {
  id: string
  path: string
  spec: VideoSpec
}

const formatSpec = (spec: VideoSpec): string =>
  `${spec.width}x${spec.height} ${spec.frameRate}fps ${spec.codec} ${spec.pixelFormat}`

const specsMatch = (a: VideoSpec, b: VideoSpec): boolean =>
  a.width === b.width &&
  a.height === b.height &&
  a.frameRate === b.frameRate &&
  a.codec === b.codec &&
  a.pixelFormat === b.pixelFormat

export class ClipPlanner {
  private readonly presetResources: Map<string, PresetClipResources>

  constructor(private readonly mediaPipeline: MediaPipeline, presets: ResolvedPreset[]) {
    this.presetResources = new Map(
      presets.map((preset) => [
        preset.id,
        {
          speechPools: this.buildSpeechPools(preset.speechMotions),
          idleLarge: preset.idleMotions.large,
          idleSmall: preset.idleMotions.small,
          speechEnterTransitions: this.buildTransitionMap(preset.speechTransitions?.enter),
          speechExitTransitions: this.buildTransitionMap(preset.speechTransitions?.exit),
        },
      ])
    )
  }

  async validateMotionSpecs(presets: ResolvedPreset[]): Promise<boolean> {
    const entries: MotionSpecEntry[] = []
    const seenPaths = new Set<string>()

    const collectMotion = async (id: string, absolutePath: string) => {
      if (seenPaths.has(absolutePath)) return
      seenPaths.add(absolutePath)
      try {
        const spec = await this.mediaPipeline.getVideoSpec(absolutePath)
        entries.push({ id, path: absolutePath, spec })
      } catch (err) {
        logger.warn({ id, path: absolutePath, err }, 'モーションファイルの仕様を取得できませんでした')
      }
    }

    for (const preset of presets) {
      for (const motion of preset.idleMotions.large) {
        await collectMotion(motion.id, motion.absolutePath)
      }
      for (const motion of preset.idleMotions.small) {
        await collectMotion(motion.id, motion.absolutePath)
      }
      for (const motion of preset.speechMotions.large) {
        await collectMotion(motion.id, motion.absolutePath)
      }
      for (const motion of preset.speechMotions.small) {
        await collectMotion(motion.id, motion.absolutePath)
      }
      if (preset.speechTransitions?.enter) {
        for (const motion of preset.speechTransitions.enter) {
          await collectMotion(motion.id, motion.absolutePath)
        }
      }
      if (preset.speechTransitions?.exit) {
        for (const motion of preset.speechTransitions.exit) {
          await collectMotion(motion.id, motion.absolutePath)
        }
      }
      for (const action of preset.actions) {
        await collectMotion(action.id, action.absolutePath)
      }
    }

    if (entries.length === 0) {
      return true
    }

    const referenceSpec = entries[0].spec
    const allMatch = entries.every((e) => specsMatch(e.spec, referenceSpec))

    if (!allMatch) {
      const specGroups = new Map<string, MotionSpecEntry[]>()
      for (const entry of entries) {
        const key = formatSpec(entry.spec)
        if (!specGroups.has(key)) {
          specGroups.set(key, [])
        }
        specGroups.get(key)!.push(entry)
      }

      // 多数決で基準仕様を決定
      let majoritySpec: VideoSpec | undefined
      let majorityKey = ''
      let majorityCount = 0
      for (const [key, motions] of specGroups) {
        if (motions.length > majorityCount) {
          majorityCount = motions.length
          majorityKey = key
          majoritySpec = motions[0].spec
        }
      }

      const lines: string[] = [
        '',
        '========================================',
        '⚠️  モーション仕様の不一致を検出',
        '========================================',
        '',
        'モーションファイルの仕様が統一されていません。',
        'concat時に動画が固まる・乱れるなどの問題が発生する可能性があります。',
        '',
        '--- モーション仕様一覧 ---',
      ]

      for (const [spec, motions] of specGroups) {
        lines.push('')
        const isMajority = spec === majorityKey
        lines.push(`[${spec}]${isMajority ? ' ← 推奨基準 (最多)' : ''}`)
        for (const motion of motions) {
          lines.push(`  - ${motion.id}`)
          lines.push(`    ${motion.path}`)
        }
      }

      if (majoritySpec) {
        const toConvert = entries.filter((e) => !specsMatch(e.spec, majoritySpec!))
        if (toConvert.length > 0) {
          const fpsValue = majoritySpec.frameRate.includes('/')
            ? majoritySpec.frameRate.split('/')[0]
            : majoritySpec.frameRate

          lines.push('')
          lines.push('--- 推奨変換コマンド ---')
          lines.push(`基準仕様: ${majorityKey} (${majorityCount}ファイルが該当)`)
          lines.push('')
          lines.push('以下のファイルを変換してください:')
          lines.push('')

          for (const entry of toConvert) {
            const outputPath = entry.path.replace(/\.mp4$/, '_converted.mp4')
            lines.push(
              `ffmpeg -i "${entry.path}" -vf "scale=${majoritySpec.width}:${majoritySpec.height},fps=${fpsValue}" -c:v libx264 -pix_fmt ${majoritySpec.pixelFormat} -an "${outputPath}"`
            )
          }
        }
      }

      lines.push('')
      lines.push('========================================')
      lines.push('')

      logger.warn(lines.join('\n'))
      return false
    }

    return true
  }

  async buildSpeechPlan(presetId: string, emotion: string | undefined, durationMs: number): Promise<ClipPlanResult> {
    const resources = this.getPresetResources(presetId)
    const normalizedEmotion = normalizeEmotion(emotion)
    const corePlan = await this.buildSpeechCorePlan(resources, normalizedEmotion, durationMs)

    const clips = [...corePlan.clips]
    const motionIds = [...corePlan.motionIds]
    let totalDuration = corePlan.totalDurationMs
    let enterDurationMs: number | undefined
    let exitDurationMs: number | undefined

    const enterTransition = this.pickTransitionMotion(resources.speechEnterTransitions, normalizedEmotion)
    if (enterTransition) {
      const enterClip = await this.buildTransitionClip(enterTransition)
      clips.unshift(enterClip)
      motionIds.unshift(enterClip.id)
      totalDuration += enterClip.durationMs
      enterDurationMs = enterClip.durationMs
    }

    const exitTransition = this.pickTransitionMotion(resources.speechExitTransitions, normalizedEmotion)
    if (exitTransition) {
      const exitClip = await this.buildTransitionClip(exitTransition)
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

  async buildIdlePlan(presetId: string, durationMs: number, motionId?: string, emotion?: string): Promise<ClipPlanResult> {
    const resources = this.getPresetResources(presetId)
    const normalizedEmotion = normalizeEmotion(emotion)
    if (motionId) {
      const motion = [...resources.idleLarge, ...resources.idleSmall].find((m) => m.id === motionId)
      if (!motion) {
        throw new Error(`待機モーション ${motionId} が見つかりません`)
      }
      return this.repeatSingleMotion(motion, durationMs)
    }
    const filteredLarge = normalizedEmotion
      ? resources.idleLarge.filter((motion) => normalizeEmotion(motion.emotion) === normalizedEmotion)
      : resources.idleLarge
    const filteredSmall = normalizedEmotion
      ? resources.idleSmall.filter((motion) => normalizeEmotion(motion.emotion) === normalizedEmotion)
      : resources.idleSmall
    const fallbackEmotionLarge = filteredLarge.length ? filteredLarge : resources.idleLarge
    const fallbackEmotionSmall = filteredSmall.length ? filteredSmall : resources.idleSmall
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

  private getPresetResources(presetId: string): PresetClipResources {
    const resources = this.presetResources.get(presetId)
    if (!resources) {
      throw new Error(`presetId=${presetId} のモーションが見つかりません`)
    }
    return resources
  }

  private async buildSpeechCorePlan(
    resources: PresetClipResources,
    normalizedEmotion: string | undefined,
    durationMs: number
  ): Promise<ClipPlanResult> {
    const pool =
      (normalizedEmotion && resources.speechPools.get(normalizedEmotion)) ??
      resources.speechPools.get('neutral') ??
      [...resources.speechPools.values()][0]
    if (!pool) {
      throw new Error('speechMotions が設定されていません')
    }
    return this.fillPlan(durationMs, pool.large, pool.small)
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

  private buildTransitionMap(
    motions: ResolvedTransitionMotion[] | undefined
  ): Map<string, ResolvedTransitionMotion[]> | undefined {
    if (!motions?.length) return undefined
    const map = new Map<string, ResolvedTransitionMotion[]>()
    for (const motion of motions) {
      const emotion = motion.emotion ?? 'neutral'
      const key = normalizeEmotion(emotion) ?? 'neutral'
      if (!map.has(key)) {
        map.set(key, [])
      }
      map.get(key)!.push(motion)
    }
    return map
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
      if (clips.length > MAX_REPEAT_CLIPS) break
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

    // targetDurationMs が極端に短い場合、while ループを一度も通らずにここまで到達しうる。
    if (!plan.length) {
      const fallback =
        this.pickAnyCandidate(smallCandidates) ?? this.pickAnyCandidate(largeCandidates)
      if (fallback) {
        plan.push({
          id: fallback.motion.id,
          path: fallback.motion.absolutePath,
          durationMs: fallback.durationMs,
        })
        covered += fallback.durationMs
      }
    }

    return {
      clips: plan,
      totalDurationMs: covered,
      motionIds: plan.map((clip) => clip.id),
    }
  }

  private async buildCandidates(motions: ResolvedIdleMotion[]): Promise<ClipCandidate[]> {
    const candidates: ClipCandidate[] = []
    for (const motion of motions) {
      try {
        const durationMs = await this.mediaPipeline.getVideoDurationMs(motion.absolutePath)
        if (durationMs > EPSILON_MS) {
          candidates.push({ motion, durationMs })
        }
      } catch {
        // skip motions that fail to probe
      }
    }
    return candidates
  }

  private pickCandidate(candidates: ClipCandidate[], remainingDuration: number): ClipCandidate | undefined {
    const valid = candidates.filter((candidate) => candidate.durationMs <= remainingDuration + EPSILON_MS)
    if (!valid.length) return undefined
    const index = Math.floor(Math.random() * valid.length)
    return valid[index]
  }

  private pickAnyCandidate(candidates: ClipCandidate[]): ClipCandidate | undefined {
    if (!candidates.length) return undefined
    const index = Math.floor(Math.random() * candidates.length)
    return candidates[index]
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

  private pickTransitionMotion(
    transitions: Map<string, ResolvedTransitionMotion[]> | undefined,
    emotion: string | undefined
  ): ResolvedTransitionMotion | undefined {
    if (!transitions) return undefined
    if (emotion && transitions.has(emotion)) {
      return transitions.get(emotion)?.[0]
    }
    if (transitions.has('neutral')) {
      return transitions.get('neutral')?.[0]
    }
    return [...transitions.values()][0]?.[0]
  }
}
