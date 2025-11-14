import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { loadConfig, type ResolvedConfig } from '../../src/config/loader'
import type { MediaPipeline } from '../../src/services/media-pipeline'
import { ClipPlanner } from '../../src/services/clip-planner'

class StubMediaPipeline implements Pick<MediaPipeline, 'getVideoDurationMs'> {
  constructor(private readonly durations: Map<string, number>) {}

  async getVideoDurationMs(assetPath: string): Promise<number> {
    const duration = this.durations.get(assetPath)
    if (duration === undefined) {
      throw new Error(`Missing duration for ${assetPath}`)
    }
    return duration
  }
}

describe('ClipPlanner timeline generation', () => {
  let clipPlanner: ClipPlanner
  let config: ResolvedConfig
  let character: ResolvedConfig['characters'][number]

  beforeAll(async () => {
    const configPath = path.resolve(process.cwd(), 'config/example.stream-profile.json')
    config = await loadConfig(configPath)
    character = config.characters[0]
    const durations = new Map<string, number>()
    const register = (assetPath?: string, fallback = 1200) => {
      if (assetPath && !durations.has(assetPath)) {
        durations.set(assetPath, fallback)
      }
    }
    character.actions.forEach((action) => register(action.absolutePath))
    character.idleMotions.large.forEach((motion) => register(motion.absolutePath, 1500))
    character.idleMotions.small.forEach((motion) => register(motion.absolutePath, 800))
    character.speechMotions.large.forEach((motion) => register(motion.absolutePath, 900))
    character.speechMotions.small.forEach((motion) => register(motion.absolutePath, 400))
    character.speechTransitions?.enter?.forEach((motion) => register(motion.absolutePath, 200))
    character.speechTransitions?.exit?.forEach((motion) => register(motion.absolutePath, 200))
    const mediaPipeline = new StubMediaPipeline(durations)
    clipPlanner = new ClipPlanner(mediaPipeline as unknown as MediaPipeline, config.characters)
  })

  it('adds enter/exit transitions when speech emotion matches', async () => {
    const plan = await clipPlanner.buildSpeechPlan(character.id, 'neutral', 2000)

    expect(plan.motionIds.at(0)).toBe(character.speechTransitions?.enter?.[0]?.id)
    expect(plan.motionIds.at(-1)).toBe(character.speechTransitions?.exit?.[0]?.id)
    expect(plan.enterDurationMs).toBeGreaterThan(0)
    expect(plan.exitDurationMs).toBeGreaterThan(0)
    expect(plan.totalDurationMs).toBeGreaterThan(plan.talkDurationMs ?? 0)
  })

  it('falls back to neutral transitions when speech emotion differs', async () => {
    const plan = await clipPlanner.buildSpeechPlan(character.id, 'sad', 2000)

    expect(plan.enterDurationMs).toBeGreaterThan(0)
    expect(plan.exitDurationMs).toBeGreaterThan(0)
    expect(character.speechTransitions?.enter).toBeDefined()
    expect(plan.motionIds.at(0)).toBe(character.speechTransitions?.enter?.[0]?.id)
    expect(plan.motionIds.at(-1)).toBe(character.speechTransitions?.exit?.[0]?.id)
  })

  it('repeats an explicit idle motion to satisfy long durations', async () => {
    const targetMotion = character.idleMotions.large[0]
    const requestedDuration = 8000

    const plan = await clipPlanner.buildIdlePlan(character.id, requestedDuration, targetMotion.id)

    expect(plan.motionIds.length).toBeGreaterThan(1)
    expect(plan.motionIds.every((id) => id === targetMotion.id)).toBe(true)
    expect(plan.totalDurationMs).toBeGreaterThanOrEqual(requestedDuration - 100)
  })

  it('fills idle plan from pools when no motion id is given', async () => {
    const idleIds = new Set(
      [...character.idleMotions.large, ...character.idleMotions.small].map((motion) => motion.id)
    )

    const plan = await clipPlanner.buildIdlePlan(character.id, 2500)

    expect(plan.motionIds.length).toBeGreaterThan(0)
    expect(plan.motionIds.every((id) => idleIds.has(id))).toBe(true)
    expect(plan.totalDurationMs).toBeGreaterThanOrEqual(2500 - 100)
  })

  it('builds action clip timelines using the original video duration', async () => {
    const action = character.actions[0]
    const plan = await clipPlanner.buildActionClip(action)

    expect(plan.clips).toHaveLength(1)
    expect(plan.clips[0].id).toBe(action.id)
    expect(plan.totalDurationMs).toBeGreaterThan(0)
    expect(plan.motionIds).toEqual([action.id])
  })
})
