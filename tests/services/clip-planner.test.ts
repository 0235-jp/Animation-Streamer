import path from 'node:path'
import { describe, it, expect, beforeAll } from 'vitest'
import { loadConfig, type ResolvedConfig } from '../../src/config/loader'
import { MediaPipeline } from '../../src/services/media-pipeline'
import { ClipPlanner } from '../../src/services/clip-planner'

describe('ClipPlanner timeline generation', () => {
  let clipPlanner: ClipPlanner
  let config: ResolvedConfig

  beforeAll(async () => {
    const configPath = path.resolve(process.cwd(), 'config/stream-profile.json')
    config = await loadConfig(configPath)
    const mediaPipeline = new MediaPipeline(config.assets.absoluteTempDir)
    clipPlanner = new ClipPlanner(mediaPipeline, config.speechMotions, config.idleMotions, config.speechTransitions)
  })

  it('adds enter/exit transitions when speech emotion matches', async () => {
    const plan = await clipPlanner.buildSpeechPlan('neutral', 2000)

    expect(plan.motionIds.at(0)).toBe(config.speechTransitions?.enter?.[0]?.id)
    expect(plan.motionIds.at(-1)).toBe(config.speechTransitions?.exit?.[0]?.id)
    expect(plan.enterDurationMs).toBeGreaterThan(0)
    expect(plan.exitDurationMs).toBeGreaterThan(0)
    expect(plan.totalDurationMs).toBeGreaterThan(plan.talkDurationMs ?? 0)
  })

  it('falls back to neutral transitions when speech emotion differs', async () => {
    const plan = await clipPlanner.buildSpeechPlan('sad', 2000)

    expect(plan.enterDurationMs).toBeGreaterThan(0)
    expect(plan.exitDurationMs).toBeGreaterThan(0)
    expect(config.speechTransitions?.enter).toBeDefined()
    expect(plan.motionIds.at(0)).toBe(config.speechTransitions?.enter?.[0]?.id)
    expect(plan.motionIds.at(-1)).toBe(config.speechTransitions?.exit?.[0]?.id)
  })

  it('repeats an explicit idle motion to satisfy long durations', async () => {
    const targetMotion = config.idleMotions.large[0]
    const requestedDuration = 8000

    const plan = await clipPlanner.buildIdlePlan(requestedDuration, targetMotion.id)

    expect(plan.motionIds.length).toBeGreaterThan(1)
    expect(plan.motionIds.every((id) => id === targetMotion.id)).toBe(true)
    expect(plan.totalDurationMs).toBeGreaterThanOrEqual(requestedDuration - 100)
  })

  it('fills idle plan from pools when no motion id is given', async () => {
    const idleIds = new Set([...config.idleMotions.large, ...config.idleMotions.small].map((motion) => motion.id))

    const plan = await clipPlanner.buildIdlePlan(2500)

    expect(plan.motionIds.length).toBeGreaterThan(0)
    expect(plan.motionIds.every((id) => idleIds.has(id))).toBe(true)
    expect(plan.totalDurationMs).toBeGreaterThanOrEqual(2500 - 100)
  })

  it('builds action clip timelines using the original video duration', async () => {
    const action = config.actions[0]
    const plan = await clipPlanner.buildActionClip(action)

    expect(plan.clips).toHaveLength(1)
    expect(plan.clips[0].id).toBe(action.id)
    expect(plan.totalDurationMs).toBeGreaterThan(0)
    expect(plan.motionIds).toEqual([action.id])
  })
})
