import path from 'node:path'
import type {
  ResolvedConfig,
  ResolvedAction,
  ResolvedIdleMotion,
  ResolvedSpeechMotion,
  ResolvedSpeechTransitions,
} from '../../src/config/loader'

const assetsDir = path.resolve(process.cwd(), 'config/tmp')
const motionDir = path.resolve(process.cwd(), 'example/motion')

const createMotion = (options: {
  id: string
  file: string
  type: 'large' | 'small'
  emotion?: string
}): ResolvedIdleMotion => ({
  id: options.id,
  type: options.type,
  path: path.relative(path.resolve(process.cwd(), 'config'), path.join(motionDir, options.file)),
  absolutePath: path.join(motionDir, options.file),
  emotion: (options.emotion ?? 'neutral').toLowerCase(),
})

const baseIdleLarge = createMotion({ id: 'idle-large', file: 'idle.mp4', type: 'large' })
const baseIdleSmall = createMotion({ id: 'idle-small', file: 'talk_idle.mp4', type: 'small' })
const baseSpeechLarge: ResolvedSpeechMotion = {
  ...createMotion({ id: 'talk-large', file: 'talk_large.mp4', type: 'large' }),
}
const baseSpeechSmall: ResolvedSpeechMotion = {
  ...createMotion({ id: 'talk-small', file: 'talk_small.mp4', type: 'small' }),
}

const baseAction: ResolvedAction = {
  id: 'start',
  path: '../example/motion/idle_talk.mp4',
  absolutePath: path.join(motionDir, 'idle_talk.mp4'),
}

const baseTransitions: ResolvedSpeechTransitions = {
  enter: [
    {
      id: 'idle-talk',
      emotion: 'neutral',
      path: '../example/motion/idle_talk.mp4',
      absolutePath: path.join(motionDir, 'idle_talk.mp4'),
    },
    {
      id: 'idle-talk-happy',
      emotion: 'happy',
      path: '../example/motion/idle_talk.mp4',
      absolutePath: path.join(motionDir, 'idle_talk.mp4'),
    },
  ],
  exit: [
    {
      id: 'talk-idle',
      emotion: 'neutral',
      path: '../example/motion/talk_idle.mp4',
      absolutePath: path.join(motionDir, 'talk_idle.mp4'),
    },
    {
      id: 'talk-idle-happy',
      emotion: 'happy',
      path: '../example/motion/talk_idle.mp4',
      absolutePath: path.join(motionDir, 'talk_idle.mp4'),
    },
  ],
}

const baseConfig: ResolvedConfig = {
  server: { port: 4000 },
  actions: [baseAction],
  idleMotions: {
    large: [baseIdleLarge],
    small: [baseIdleSmall],
  },
  speechMotions: {
    large: [baseSpeechLarge],
    small: [baseSpeechSmall],
  },
  speechTransitions: baseTransitions,
  audioProfile: {
    ttsEngine: 'voicevox',
    voicevoxUrl: 'http://127.0.0.1:50021',
    speakerId: 1,
  },
  assets: {
    tempDir: './tmp',
    absoluteTempDir: assetsDir,
  },
}

const cloneConfig = (): ResolvedConfig => ({
  server: { ...baseConfig.server },
  actions: baseConfig.actions.map((action) => ({ ...action })),
  idleMotions: {
    large: baseConfig.idleMotions.large.map((motion) => ({ ...motion })),
    small: baseConfig.idleMotions.small.map((motion) => ({ ...motion })),
  },
  speechMotions: {
    large: baseConfig.speechMotions.large.map((motion) => ({ ...motion })),
    small: baseConfig.speechMotions.small.map((motion) => ({ ...motion })),
  },
  speechTransitions: baseConfig.speechTransitions && {
    enter: baseConfig.speechTransitions.enter
      ? baseConfig.speechTransitions.enter.map((motion) => ({ ...motion }))
      : undefined,
    exit: baseConfig.speechTransitions.exit
      ? baseConfig.speechTransitions.exit.map((motion) => ({ ...motion }))
      : undefined,
  },
  audioProfile: { ...baseConfig.audioProfile },
  assets: { ...baseConfig.assets },
})

export const createResolvedConfig = (overrides?: Partial<ResolvedConfig>): ResolvedConfig => {
  const config = cloneConfig()
  if (!overrides) return config
  return {
    ...config,
    ...overrides,
    server: overrides.server ?? config.server,
    actions: overrides.actions ?? config.actions,
    idleMotions: overrides.idleMotions ?? config.idleMotions,
    speechMotions: overrides.speechMotions ?? config.speechMotions,
    speechTransitions: overrides.speechTransitions ?? config.speechTransitions,
    audioProfile: overrides.audioProfile ?? config.audioProfile,
    assets: overrides.assets ?? config.assets,
  }
}
