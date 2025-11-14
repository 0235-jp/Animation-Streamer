import { promises as fs } from 'node:fs'
import path from 'node:path'
import { configSchema, type StreamerConfig } from './schema'

export interface ResolvedAction {
  id: string
  path: string
  absolutePath: string
}

export interface ResolvedIdleMotion {
  id: string
  type: 'large' | 'small'
  path: string
  absolutePath: string
  emotion: string
}

export interface ResolvedSpeechMotion extends ResolvedIdleMotion {}

export interface ResolvedIdlePools {
  large: ResolvedIdleMotion[]
  small: ResolvedIdleMotion[]
}

export interface ResolvedSpeechPools {
  large: ResolvedSpeechMotion[]
  small: ResolvedSpeechMotion[]
}

export interface ResolvedTransitionMotion {
  id: string
  emotion: string
  path: string
  absolutePath: string
}

export interface ResolvedSpeechTransitions {
  enter?: ResolvedTransitionMotion[]
  exit?: ResolvedTransitionMotion[]
}

export interface VoicevoxVoiceProfile {
  emotion: string
  speakerId: number
  speedScale?: number
  pitchScale?: number
  intonationScale?: number
  volumeScale?: number
  outputSamplingRate?: number
  outputStereo?: boolean
}

export interface ResolvedAudioProfile {
  ttsEngine: 'voicevox'
  voicevoxUrl: string
  defaultVoice: VoicevoxVoiceProfile
  voices: VoicevoxVoiceProfile[]
}

export interface ResolvedCharacter {
  id: string
  displayName?: string
  actions: ResolvedAction[]
  actionsMap: Map<string, ResolvedAction>
  idleMotions: ResolvedIdlePools
  speechMotions: ResolvedSpeechPools
  speechTransitions?: ResolvedSpeechTransitions
  audioProfile: ResolvedAudioProfile
}

export interface ResolvedConfig extends Omit<StreamerConfig, 'characters' | 'assets'> {
  characters: ResolvedCharacter[]
  characterMap: Map<string, ResolvedCharacter>
  assets: {
    tempDir: string
    absoluteTempDir: string
  }
}

export const loadConfig = async (configPath: string): Promise<ResolvedConfig> => {
  const raw = await fs.readFile(configPath, 'utf8')
  const parsed = configSchema.parse(JSON.parse(raw))

  const baseDir = path.dirname(configPath)
  const resolveAssetPath = (assetPath: string) => path.resolve(baseDir, assetPath)

  const characters = parsed.characters.map((character) => resolveCharacter(character, resolveAssetPath))
  const characterMap = new Map<string, ResolvedCharacter>()
  for (const character of characters) {
    if (characterMap.has(character.id)) {
      throw new Error(`Duplicate character id detected: ${character.id}`)
    }
    characterMap.set(character.id, character)
  }

  const absoluteTempDir = path.resolve(baseDir, parsed.assets.tempDir)
  await fs.mkdir(absoluteTempDir, { recursive: true })

  return {
    server: parsed.server,
    characters,
    characterMap,
    assets: {
      tempDir: parsed.assets.tempDir,
      absoluteTempDir,
    },
  }
}

const resolveCharacter = (
  character: StreamerConfig['characters'][number],
  resolveAssetPath: (assetPath: string) => string
): ResolvedCharacter => {
  const actions: ResolvedAction[] = character.actions.map((action) => ({
    ...action,
    absolutePath: resolveAssetPath(action.path),
  }))

  const idleMotions: ResolvedIdlePools = {
    large: character.idleMotions.large.map((motion) => ({
      ...motion,
      type: 'large' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveAssetPath(motion.path),
    })),
    small: character.idleMotions.small.map((motion) => ({
      ...motion,
      type: 'small' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveAssetPath(motion.path),
    })),
  }

  const speechMotions: ResolvedSpeechPools = {
    large: character.speechMotions.large.map((motion) => ({
      ...motion,
      type: 'large' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveAssetPath(motion.path),
    })),
    small: character.speechMotions.small.map((motion) => ({
      ...motion,
      type: 'small' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveAssetPath(motion.path),
    })),
  }

  const normalizeTransition = (motion: { id: string; emotion: string; path: string }): ResolvedTransitionMotion => ({
    ...motion,
    emotion: motion.emotion.toLowerCase(),
    absolutePath: resolveAssetPath(motion.path),
  })

  const toTransitionList = (
    value?: { id: string; emotion: string; path: string } | { id: string; emotion: string; path: string }[]
  ): ResolvedTransitionMotion[] | undefined => {
    if (!value) return undefined
    const list = Array.isArray(value) ? value : [value]
    return list.map(normalizeTransition)
  }

  const speechTransitions: ResolvedSpeechTransitions | undefined = character.speechTransitions
    ? {
        enter: toTransitionList(character.speechTransitions.enter),
        exit: toTransitionList(character.speechTransitions.exit),
      }
    : undefined

  const normalizeVoiceEmotion = (emotion: string | undefined) => (emotion?.trim().toLowerCase() ?? 'neutral')
  const normalizeVoice = (voice: VoicevoxVoiceProfile): VoicevoxVoiceProfile => ({
    ...voice,
    emotion: normalizeVoiceEmotion(voice.emotion),
  })

  const defaultVoice = normalizeVoice({
    emotion: 'neutral',
    speakerId: character.audioProfile.speakerId,
    speedScale: character.audioProfile.speedScale,
    pitchScale: character.audioProfile.pitchScale,
    intonationScale: character.audioProfile.intonationScale,
    volumeScale: character.audioProfile.volumeScale,
    outputSamplingRate: character.audioProfile.outputSamplingRate,
    outputStereo: character.audioProfile.outputStereo,
  })

  const voices = (character.audioProfile.voices ?? []).map(normalizeVoice)

  const actionsMap = new Map(actions.map((action) => [action.id.toLowerCase(), action]))

  return {
    id: character.id,
    displayName: character.displayName,
    actions,
    actionsMap,
    idleMotions,
    speechMotions,
    speechTransitions,
    audioProfile: {
      ttsEngine: character.audioProfile.ttsEngine,
      voicevoxUrl: character.audioProfile.voicevoxUrl,
      defaultVoice,
      voices,
    },
  }
}
