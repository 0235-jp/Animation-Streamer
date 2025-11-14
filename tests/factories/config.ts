import path from 'node:path'
import type {
  ResolvedAction,
  ResolvedAudioProfile,
  ResolvedCharacter,
  ResolvedConfig,
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

const baseAudioProfile: ResolvedAudioProfile = {
  ttsEngine: 'voicevox',
  voicevoxUrl: 'http://127.0.0.1:50021',
  defaultVoice: {
    emotion: 'neutral',
    speakerId: 1,
    speedScale: 1,
    pitchScale: 0,
    intonationScale: 1,
    volumeScale: 1,
    outputSamplingRate: 24000,
    outputStereo: false,
  },
  voices: [
    {
      emotion: 'neutral',
      speakerId: 1,
      speedScale: 1.05,
    },
    {
      emotion: 'happy',
      speakerId: 2,
      pitchScale: 0.2,
    },
  ],
}

const createCharacter = (): ResolvedCharacter => {
  const actions: ResolvedAction[] = [baseAction].map((action) => ({ ...action }))
  const actionsMap = new Map(actions.map((action) => [action.id.toLowerCase(), action]))
  return {
    id: 'anchor-a',
    displayName: 'Anchor A',
    actions,
    actionsMap,
    idleMotions: {
      large: [baseIdleLarge].map((motion) => ({ ...motion })),
      small: [baseIdleSmall].map((motion) => ({ ...motion })),
    },
    speechMotions: {
      large: [baseSpeechLarge].map((motion) => ({ ...motion })),
      small: [baseSpeechSmall].map((motion) => ({ ...motion })),
    },
    speechTransitions: {
      enter: baseTransitions.enter?.map((motion) => ({ ...motion })),
      exit: baseTransitions.exit?.map((motion) => ({ ...motion })),
    },
    audioProfile: {
      ...baseAudioProfile,
      defaultVoice: { ...baseAudioProfile.defaultVoice },
      voices: baseAudioProfile.voices.map((voice) => ({ ...voice })),
    },
  }
}

const cloneConfig = (): ResolvedConfig => {
  const characters = [createCharacter()]
  return {
    server: { port: 4000 },
    characters,
    characterMap: new Map(characters.map((character) => [character.id, character])),
    assets: {
      tempDir: './tmp',
      absoluteTempDir: assetsDir,
    },
  }
}

export const createResolvedConfig = (overrides?: Partial<ResolvedConfig>): ResolvedConfig => {
  const config = cloneConfig()
  if (!overrides) return config
  const merged: ResolvedConfig = {
    ...config,
    ...overrides,
    server: overrides.server ?? config.server,
    characters: overrides.characters ?? config.characters,
    assets: overrides.assets ?? config.assets,
  }
  merged.characterMap =
    overrides.characterMap ?? new Map(merged.characters.map((character) => [character.id, character]))
  return merged
}
