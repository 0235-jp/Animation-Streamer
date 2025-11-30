import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { configSchema, type StreamerConfig } from './schema'
import type { AudioProfile, TtsEngineType } from '../services/tts/schema'

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

/** 音声プロファイル（感情別の音声設定）の基本型 */
export interface BaseVoiceProfile {
  emotion: string
  speedScale?: number
  pitchScale?: number
  intonationScale?: number
  volumeScale?: number
  outputSamplingRate?: number
  outputStereo?: boolean
}

/** VOICEVOX互換エンジン用の音声プロファイル */
export interface VoicevoxVoiceProfile extends BaseVoiceProfile {
  speakerId: number
}

/** OpenAI TTS用の音声プロファイル */
export interface OpenAiVoiceProfile extends BaseVoiceProfile {
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer'
  model?: 'tts-1' | 'tts-1-hd'
}

/** Style-Bert-VITS2用の音声プロファイル */
export interface StyleBertVits2VoiceProfile extends BaseVoiceProfile {
  modelName: string
  language?: string
  style?: string
  styleWeight?: number
}

/** Google Cloud TTS用の音声プロファイル */
export interface GoogleTtsVoiceProfile extends BaseVoiceProfile {
  languageCode: string
  voiceName: string
}

/** Azure TTS用の音声プロファイル */
export interface AzureTtsVoiceProfile extends BaseVoiceProfile {
  voiceName: string
  languageCode?: string
  style?: string
  styleDegree?: number
}

/** ElevenLabs用の音声プロファイル */
export interface ElevenLabsVoiceProfile extends BaseVoiceProfile {
  voiceId: string
  modelId?: string
  stability?: number
  similarityBoost?: number
}

/** 解決済みの音声プロファイル（各エンジン共通） */
export type ResolvedVoiceProfile =
  | VoicevoxVoiceProfile
  | OpenAiVoiceProfile
  | StyleBertVits2VoiceProfile
  | GoogleTtsVoiceProfile
  | AzureTtsVoiceProfile
  | ElevenLabsVoiceProfile
  | BaseVoiceProfile

/** 解決済みのオーディオプロファイル */
export interface ResolvedAudioProfile {
  /** TTSエンジンの種類 */
  ttsEngine: TtsEngineType
  /** エンジン固有の設定（AudioProfileから取得） */
  engineConfig: AudioProfile
  /** デフォルトの音声プロファイル */
  defaultVoice: ResolvedVoiceProfile
  /** 感情別の音声プロファイル一覧 */
  voices: ResolvedVoiceProfile[]
}

export interface ResolvedPreset {
  id: string
  displayName?: string
  actions: ResolvedAction[]
  actionsMap: Map<string, ResolvedAction>
  idleMotions: ResolvedIdlePools
  speechMotions: ResolvedSpeechPools
  speechTransitions?: ResolvedSpeechTransitions
  audioProfile: ResolvedAudioProfile
}

export interface ResolvedPaths {
  projectRoot: string
  motionsDir: string
  outputDir: string
  responsePathBase?: string
}

export interface ResolvedConfig extends Omit<StreamerConfig, 'presets'> {
  presets: ResolvedPreset[]
  presetMap: Map<string, ResolvedPreset>
  paths: ResolvedPaths
  rtmp: {
    outputUrl: string
  }
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

  // エンジン種類に応じた音声プロファイル解決
  const audioProfile = resolveAudioProfile(preset.audioProfile, normalizeVoiceEmotion)

  const actionsMap = new Map(actions.map((action) => [action.id.toLowerCase(), action]))

  return {
    id: preset.id,
    displayName: preset.displayName,
    actions,
    actionsMap,
    idleMotions,
    speechMotions,
    speechTransitions,
    audioProfile,
  }
}

/** エンジン種類に応じてオーディオプロファイルを解決 */
const resolveAudioProfile = (
  profile: AudioProfile,
  normalizeEmotion: (emotion: string | undefined) => string
): ResolvedAudioProfile => {
  const ttsEngine = profile.ttsEngine

  switch (ttsEngine) {
    case 'voicevox':
    case 'coeiroink':
    case 'aivis_speech': {
      const defaultVoice: VoicevoxVoiceProfile = {
        emotion: 'neutral',
        speakerId: profile.speakerId,
        speedScale: profile.speedScale,
        pitchScale: profile.pitchScale,
        intonationScale: profile.intonationScale,
        volumeScale: profile.volumeScale,
        outputSamplingRate: profile.outputSamplingRate,
        outputStereo: profile.outputStereo,
      }
      const voices: VoicevoxVoiceProfile[] = (profile.voices ?? []).map((v) => ({
        ...v,
        emotion: normalizeEmotion(v.emotion),
      }))
      return { ttsEngine, engineConfig: profile, defaultVoice, voices }
    }

    case 'openai': {
      const defaultVoice: OpenAiVoiceProfile = {
        emotion: 'neutral',
        voice: profile.voice,
        model: profile.model,
        speedScale: profile.speedScale,
      }
      const voices: OpenAiVoiceProfile[] = (profile.voices ?? []).map((v) => ({
        ...v,
        emotion: normalizeEmotion(v.emotion),
      }))
      return { ttsEngine, engineConfig: profile, defaultVoice, voices }
    }

    case 'style_bert_vits2': {
      const defaultVoice: StyleBertVits2VoiceProfile = {
        emotion: 'neutral',
        modelName: profile.modelName,
        language: profile.language,
        style: profile.style,
        styleWeight: profile.styleWeight,
        speedScale: profile.speedScale,
      }
      const voices: StyleBertVits2VoiceProfile[] = (profile.voices ?? []).map((v) => ({
        ...v,
        emotion: normalizeEmotion(v.emotion),
      }))
      return { ttsEngine, engineConfig: profile, defaultVoice, voices }
    }

    case 'google': {
      const defaultVoice: GoogleTtsVoiceProfile = {
        emotion: 'neutral',
        languageCode: profile.languageCode,
        voiceName: profile.voiceName,
        speedScale: profile.speedScale,
        pitchScale: profile.pitchScale,
        volumeScale: profile.volumeScale,
      }
      const voices: GoogleTtsVoiceProfile[] = (profile.voices ?? []).map((v) => ({
        ...v,
        emotion: normalizeEmotion(v.emotion),
      }))
      return { ttsEngine, engineConfig: profile, defaultVoice, voices }
    }

    case 'azure': {
      const defaultVoice: AzureTtsVoiceProfile = {
        emotion: 'neutral',
        voiceName: profile.voiceName,
        languageCode: profile.languageCode,
        speedScale: profile.speedScale,
        pitchScale: profile.pitchScale,
        volumeScale: profile.volumeScale,
      }
      const voices: AzureTtsVoiceProfile[] = (profile.voices ?? []).map((v) => ({
        ...v,
        emotion: normalizeEmotion(v.emotion),
      }))
      return { ttsEngine, engineConfig: profile, defaultVoice, voices }
    }

    case 'elevenlabs': {
      const defaultVoice: ElevenLabsVoiceProfile = {
        emotion: 'neutral',
        voiceId: profile.voiceId,
        modelId: profile.modelId,
        stability: profile.stability,
        similarityBoost: profile.similarityBoost,
        speedScale: profile.speedScale,
        volumeScale: profile.volumeScale,
      }
      const voices: ElevenLabsVoiceProfile[] = (profile.voices ?? []).map((v) => ({
        ...v,
        emotion: normalizeEmotion(v.emotion),
      }))
      return { ttsEngine, engineConfig: profile, defaultVoice, voices }
    }

    default: {
      const _exhaustiveCheck: never = ttsEngine
      throw new Error(`未対応のTTSエンジン: ${_exhaustiveCheck}`)
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
