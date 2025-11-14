import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClipPlanner } from '../../src/services/clip-planner'
import type {
  ResolvedAudioProfile,
  ResolvedCharacter,
  ResolvedIdleMotion,
  ResolvedSpeechMotion,
  ResolvedIdlePools,
  ResolvedSpeechPools,
  ResolvedSpeechTransitions,
} from '../../src/config/loader'
import type { MediaPipeline } from '../../src/services/media-pipeline'

class StubMediaPipeline implements Pick<MediaPipeline, 'getVideoDurationMs'> {
  constructor(private readonly durations: Record<string, number>) {}

  async getVideoDurationMs(path: string): Promise<number> {
    const duration = this.durations[path]
    if (duration === undefined) {
      throw new Error(`Missing duration for ${path}`)
    }
    return duration
  }
}

const makeMotion = (
  id: string,
  duration: number,
  type: 'large' | 'small',
  emotion = 'neutral'
): ResolvedIdleMotion => ({
  id,
  type,
  emotion,
  path: `${id}.mp4`,
  absolutePath: `/assets/${id}.mp4`,
})

const createPlanner = () => {
  const durations: Record<string, number> = {
    '/assets/speech-neutral-large.mp4': 800,
    '/assets/speech-neutral-small.mp4': 300,
    '/assets/speech-happy-small.mp4': 200,
    '/assets/idle-neutral-large.mp4': 600,
    '/assets/idle-neutral-small.mp4': 250,
    '/assets/idle-happy-small.mp4': 200,
    '/assets/transition-enter.mp4': 250,
    '/assets/transition-exit.mp4': 200,
    '/assets/transition-enter-happy.mp4': 220,
    '/assets/transition-exit-happy.mp4': 180,
  }

  const speechMotions: ResolvedSpeechPools = {
    large: [makeMotion('speech-neutral-large', durations['/assets/speech-neutral-large.mp4'], 'large') as ResolvedSpeechMotion],
    small: [
      makeMotion('speech-neutral-small', durations['/assets/speech-neutral-small.mp4'], 'small') as ResolvedSpeechMotion,
      makeMotion('speech-happy-small', durations['/assets/speech-happy-small.mp4'], 'small', 'happy') as ResolvedSpeechMotion,
    ],
  }

  const idleMotions: ResolvedIdlePools = {
    large: [
      makeMotion('idle-neutral-large', durations['/assets/idle-neutral-large.mp4'], 'large'),
      makeMotion('idle-neutral-small', durations['/assets/idle-neutral-small.mp4'], 'large', 'happy'),
    ],
    small: [makeMotion('idle-happy-small', durations['/assets/idle-happy-small.mp4'], 'small', 'happy')],
  }

  const speechTransitions: ResolvedSpeechTransitions = {
    enter: [
      {
        id: 'enter-transition',
        emotion: 'neutral',
        path: 'enter.mp4',
        absolutePath: '/assets/transition-enter.mp4',
      },
      {
        id: 'enter-transition-happy',
        emotion: 'happy',
        path: 'enter-happy.mp4',
        absolutePath: '/assets/transition-enter-happy.mp4',
      },
    ],
    exit: [
      {
        id: 'exit-transition',
        emotion: 'neutral',
        path: 'exit.mp4',
        absolutePath: '/assets/transition-exit.mp4',
      },
      {
        id: 'exit-transition-happy',
        emotion: 'happy',
        path: 'exit-happy.mp4',
        absolutePath: '/assets/transition-exit-happy.mp4',
      },
    ],
  }

  const mediaPipeline = new StubMediaPipeline(durations)
  const audioProfile: ResolvedAudioProfile = {
    ttsEngine: 'voicevox',
    voicevoxUrl: 'http://127.0.0.1:50021',
    defaultVoice: {
      emotion: 'neutral',
      speakerId: 1,
    },
    voices: [],
  }
  const character: ResolvedCharacter = {
    id: 'test-character',
    displayName: 'Test',
    actions: [],
    actionsMap: new Map(),
    idleMotions,
    speechMotions,
    speechTransitions,
    audioProfile,
  }
  const planner = new ClipPlanner(mediaPipeline as MediaPipeline, [character])
  return { planner, character }
}

describe('ClipPlanner timeline edge cases', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('falls back to neutral speech transitions when requested emotion is missing', async () => {
    const { planner, character } = createPlanner()
    const mathSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

    const plan = await planner.buildSpeechPlan(character.id, 'angry', 900)

    const speechIds = plan.motionIds.filter((id) => id.includes('speech'))
    expect(speechIds.every((id) => id.includes('neutral'))).toBe(true)
    expect(plan.enterDurationMs).toBeGreaterThan(0)
    expect(plan.exitDurationMs).toBeGreaterThan(0)
    expect(plan.totalDurationMs).toBeGreaterThan(0)

    mathSpy.mockRestore()
  })

  it('uses emotion-specific transitions when configured', async () => {
    const { planner, character } = createPlanner()

    const plan = await planner.buildSpeechPlan(character.id, 'happy', 700)

    expect(plan.motionIds.at(0)).toBe('enter-transition-happy')
    expect(plan.motionIds.at(-1)).toBe('exit-transition-happy')
    expect(plan.enterDurationMs).toBeGreaterThan(0)
    expect(plan.exitDurationMs).toBeGreaterThan(0)
    const speechIds = plan.motionIds.filter((id) => id.includes('speech'))
    expect(speechIds.every((id) => id.includes('small'))).toBe(true)
    expect(speechIds.some((id) => id === 'speech-happy-small')).toBe(true)
  })

  it('prefers small pool when remaining duration is shorter than large clips', async () => {
    const { planner, character } = createPlanner()
    const plan = await planner.buildSpeechPlan(character.id, 'happy', 250)

    const speechIds = plan.motionIds.filter((id) => id.includes('speech'))
    expect(speechIds.every((id) => id === 'speech-happy-small')).toBe(true)
    expect(plan.totalDurationMs + 50).toBeGreaterThanOrEqual(250)
  })

  it('filters idle motions by emotion and falls back when none match', async () => {
    const { planner, character } = createPlanner()
    const happyPlan = await planner.buildIdlePlan(character.id, 400, undefined, 'happy')
    expect(new Set(happyPlan.motionIds)).toEqual(new Set(['idle-neutral-small', 'idle-happy-small']))

    const fallbackPlan = await planner.buildIdlePlan(character.id, 400, undefined, 'sad')
    expect(fallbackPlan.motionIds.some((id) => id.includes('neutral'))).toBe(true)
  })

  it('uses explicit motion id even when emotion differs', async () => {
    const { planner, character } = createPlanner()
    const plan = await planner.buildIdlePlan(character.id, 1200, 'idle-neutral-large', 'happy')

    expect(plan.motionIds.every((id) => id === 'idle-neutral-large')).toBe(true)
    expect(plan.totalDurationMs).toBeGreaterThanOrEqual(1200)
  })
})
