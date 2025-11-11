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
  enter?: ResolvedTransitionMotion
  exit?: ResolvedTransitionMotion
}

export interface ResolvedConfig
  extends Omit<StreamerConfig, 'actions' | 'idleMotions' | 'speechMotions' | 'speechTransitions' | 'assets'> {
  actions: ResolvedAction[]
  idleMotions: ResolvedIdlePools
  speechMotions: ResolvedSpeechPools
  speechTransitions?: ResolvedSpeechTransitions
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

  const actions: ResolvedAction[] = parsed.actions.map((action) => ({
    ...action,
    absolutePath: resolveAssetPath(action.path),
  }))

  const idleMotions: ResolvedIdlePools = {
    large: parsed.idleMotions.large.map((motion) => ({
      ...motion,
      type: 'large' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveAssetPath(motion.path),
    })),
    small: parsed.idleMotions.small.map((motion) => ({
      ...motion,
      type: 'small' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveAssetPath(motion.path),
    })),
  }

  const speechMotions: ResolvedSpeechPools = {
    large: parsed.speechMotions.large.map((motion) => ({
      ...motion,
      type: 'large' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveAssetPath(motion.path),
    })),
    small: parsed.speechMotions.small.map((motion) => ({
      ...motion,
      type: 'small' as const,
      emotion: motion.emotion.toLowerCase(),
      absolutePath: resolveAssetPath(motion.path),
    })),
  }

  const speechTransitions: ResolvedSpeechTransitions | undefined = parsed.speechTransitions
    ? {
        enter: parsed.speechTransitions.enter
          ? {
              ...parsed.speechTransitions.enter,
              emotion: parsed.speechTransitions.enter.emotion.toLowerCase(),
              absolutePath: resolveAssetPath(parsed.speechTransitions.enter.path),
            }
          : undefined,
        exit: parsed.speechTransitions.exit
          ? {
              ...parsed.speechTransitions.exit,
              emotion: parsed.speechTransitions.exit.emotion.toLowerCase(),
              absolutePath: resolveAssetPath(parsed.speechTransitions.exit.path),
            }
          : undefined,
      }
    : undefined

  const absoluteTempDir = path.resolve(baseDir, parsed.assets.tempDir)
  await fs.mkdir(absoluteTempDir, { recursive: true })

  return {
    ...parsed,
    actions,
    idleMotions,
    speechMotions,
    speechTransitions,
    assets: {
      tempDir: parsed.assets.tempDir,
      absoluteTempDir,
    },
  }
}
