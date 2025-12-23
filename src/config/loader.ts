import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
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

export interface ResolvedLipSyncImages {
  A: string // あ - 大きく開いた口
  I: string // い - 横に広がった口
  U: string // う - すぼめた口
  E: string // え - 中間的に開いた口
  O: string // お - 丸く開いた口
  N: string // ん/無音 - 閉じた口
}

export interface ResolvedLipSyncVariant {
  id: string
  emotion: string
  images: ResolvedLipSyncImages
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

export interface Sbv2VoiceProfile {
  emotion: string
  modelId?: number
  modelName?: string
  speakerId?: number
  speakerName?: string
  sdpRatio?: number
  noise?: number
  noisew?: number
  length?: number
  language?: string
  style?: string
  styleWeight?: number
  assistText?: string
  assistTextWeight?: number
  autoSplit?: boolean
  splitInterval?: number
  referenceAudioPath?: string
}

export interface ResolvedSTTConfig {
  baseUrl: string
  apiKey?: string
  model: string
  language: string
}

export interface ResolvedVoicevoxAudioProfile {
  ttsEngine: 'voicevox'
  voicevoxUrl: string
  voices: VoicevoxVoiceProfile[]
}

export interface ResolvedSbv2AudioProfile {
  ttsEngine: 'style-bert-vits2'
  sbv2Url: string
  voices: Sbv2VoiceProfile[]
}

export type ResolvedAudioProfile = ResolvedVoicevoxAudioProfile | ResolvedSbv2AudioProfile

export interface ResolvedPreset {
  id: string
  displayName?: string
  actions: ResolvedAction[]
  actionsMap: Map<string, ResolvedAction>
  idleMotions: ResolvedIdlePools
  speechMotions: ResolvedSpeechPools
  speechTransitions?: ResolvedSpeechTransitions
  audioProfile: ResolvedAudioProfile
  lipSync?: ResolvedLipSyncVariant[]
}

export interface ResolvedPaths {
  projectRoot: string
  motionsDir: string
  outputDir: string
  responsePathBase?: string
}

export interface ResolvedConfig extends Omit<StreamerConfig, 'presets' | 'stt'> {
  presets: ResolvedPreset[]
  presetMap: Map<string, ResolvedPreset>
  paths: ResolvedPaths
  rtmp: {
    outputUrl: string
  }
  stt?: ResolvedSTTConfig
}

export const loadConfig = async (configPath: string): Promise<ResolvedConfig> => {
  const raw = await fs.readFile(configPath, 'utf8')
  const parsed = configSchema.parse(JSON.parse(raw))

  const baseDir = path.dirname(configPath)
  const projectRoot = path.resolve(baseDir, '..')
  const motionsDir = path.resolve(projectRoot, 'motions')
  const outputDir = path.resolve(projectRoot, 'output')
  await ensureDirectoryExists(
    motionsDir,
    `motions ディレクトリが存在しません (${motionsDir})。README のセットアップ手順で example/motion のコピーを行ってください。`
  )
  await fs.mkdir(outputDir, { recursive: true })
  const responsePathBase = process.env.RESPONSE_PATH_BASE?.trim() || undefined
  const resolveMotionPath = createMotionResolver(motionsDir)

  const presets = parsed.presets.map((preset) => resolvePreset(preset, resolveMotionPath))
  const presetMap = new Map<string, ResolvedPreset>()
  for (const preset of presets) {
    if (presetMap.has(preset.id)) {
      throw new Error(`Duplicate preset id detected: ${preset.id}`)
    }
    presetMap.set(preset.id, preset)
  }

  return {
    server: parsed.server,
    rtmp: parsed.rtmp,
    stt: parsed.stt
      ? {
          baseUrl: parsed.stt.baseUrl,
          apiKey: parsed.stt.apiKey,
          model: parsed.stt.model,
          language: parsed.stt.language,
        }
      : undefined,
    presets,
    presetMap,
    paths: {
      projectRoot,
      motionsDir,
      outputDir,
      responsePathBase,
    },
  }
}

const resolvePreset = (
  preset: StreamerConfig['presets'][number],
  resolveMotionPath: (assetPath: string) => string
): ResolvedPreset => {
  const actions: ResolvedAction[] = preset.actions.map((action) => ({
    ...action,
    absolutePath: resolveMotionPath(action.path),
  }))

  const idleMotions: ResolvedIdlePools = {
    large: preset.idleMotions.large.map((motion) => ({
      ...motion,
      type: 'large' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveMotionPath(motion.path),
    })),
    small: preset.idleMotions.small.map((motion) => ({
      ...motion,
      type: 'small' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveMotionPath(motion.path),
    })),
  }

  const speechMotions: ResolvedSpeechPools = {
    large: preset.speechMotions.large.map((motion) => ({
      ...motion,
      type: 'large' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveMotionPath(motion.path),
    })),
    small: preset.speechMotions.small.map((motion) => ({
      ...motion,
      type: 'small' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveMotionPath(motion.path),
    })),
  }

  const normalizeTransition = (motion: { id: string; emotion: string; path: string }): ResolvedTransitionMotion => ({
    ...motion,
    emotion: motion.emotion.toLowerCase(),
    absolutePath: resolveMotionPath(motion.path),
  })

  const toTransitionList = (
    value?: { id: string; emotion: string; path: string } | { id: string; emotion: string; path: string }[]
  ): ResolvedTransitionMotion[] | undefined => {
    if (!value) return undefined
    const list = Array.isArray(value) ? value : [value]
    return list.map(normalizeTransition)
  }

  const speechTransitions: ResolvedSpeechTransitions | undefined = preset.speechTransitions
    ? {
        enter: toTransitionList(preset.speechTransitions.enter),
        exit: toTransitionList(preset.speechTransitions.exit),
      }
    : undefined

  const normalizeVoiceEmotion = (emotion: string | undefined) => (emotion?.trim().toLowerCase() ?? 'neutral')

  const audioProfile = resolveAudioProfile(preset.audioProfile, normalizeVoiceEmotion)
  const actionsMap = new Map(actions.map((action) => [action.id.toLowerCase(), action]))

  // lipSync設定の解決（aiueoN形式 - 日本語母音ベース）
  const lipSync = preset.lipSync?.map((variant) => ({
    id: variant.id,
    emotion: variant.emotion.toLowerCase(),
    images: {
      A: resolveMotionPath(variant.images.A),
      I: resolveMotionPath(variant.images.I),
      U: resolveMotionPath(variant.images.U),
      E: resolveMotionPath(variant.images.E),
      O: resolveMotionPath(variant.images.O),
      N: resolveMotionPath(variant.images.N),
    },
  }))

  return {
    id: preset.id,
    displayName: preset.displayName,
    actions,
    actionsMap,
    idleMotions,
    speechMotions,
    speechTransitions,
    audioProfile,
    lipSync,
  }
}

type RawAudioProfile = StreamerConfig['presets'][number]['audioProfile']

const resolveAudioProfile = (
  rawProfile: RawAudioProfile,
  normalizeEmotion: (emotion: string | undefined) => string
): ResolvedAudioProfile => {
  if (rawProfile.ttsEngine === 'voicevox') {
    const normalizeVoicevoxVoice = (voice: VoicevoxVoiceProfile): VoicevoxVoiceProfile => ({
      ...voice,
      emotion: normalizeEmotion(voice.emotion),
    })

    const voices = (rawProfile.voices ?? []).map(normalizeVoicevoxVoice)

    return {
      ttsEngine: 'voicevox',
      voicevoxUrl: rawProfile.voicevoxUrl,
      voices,
    }
  } else {
    // style-bert-vits2
    const normalizeSbv2Voice = (voice: Sbv2VoiceProfile): Sbv2VoiceProfile => ({
      ...voice,
      emotion: normalizeEmotion(voice.emotion),
    })

    const voices = (rawProfile.voices ?? []).map(normalizeSbv2Voice)

    return {
      ttsEngine: 'style-bert-vits2',
      sbv2Url: rawProfile.sbv2Url,
      voices,
    }
  }
}

const ensureDirectoryExists = async (dir: string, errorMessage: string) => {
  try {
    await fs.access(dir)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      throw new Error(errorMessage)
    }
    throw error
  }
}

const createMotionResolver = (motionsDir: string) => {
  return (relativePath: string) => {
    const trimmed = relativePath?.trim()
    if (!trimmed) {
      throw new Error('モーションの path は必須です')
    }
    if (path.isAbsolute(trimmed)) {
      throw new Error(`モーションの path は motions/ 配下の相対パスで指定してください: ${trimmed}`)
    }
    const resolved = path.resolve(motionsDir, trimmed)
    const relative = path.relative(motionsDir, resolved)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`モーションの path は motions/ 配下の相対パスで指定してください: ${trimmed}`)
    }
    return resolved
  }
}
