import { z } from 'zod'

export const motionTypeSchema = z.enum(['large', 'small'])

export const actionSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
})

const motionVariantSchema = z.object({
  id: z.string().min(1),
  emotion: z.string().min(1).default('neutral'),
  path: z.string().min(1),
})

export const sizedMotionSchema = z.object({
  large: z.array(motionVariantSchema).min(1),
  small: z.array(motionVariantSchema).min(1),
})

export const transitionMotionSchema = z.object({
  id: z.string().min(1),
  emotion: z.string().min(1).default('neutral'),
  path: z.string().min(1),
})
const transitionCollectionSchema = z.union([transitionMotionSchema, z.array(transitionMotionSchema).min(1)])

const synthesisParamsSchema = z.object({
  speedScale: z.number().positive().optional(),
  pitchScale: z.number().optional(),
  intonationScale: z.number().nonnegative().optional(),
  volumeScale: z.number().nonnegative().optional(),
  outputSamplingRate: z.number().int().positive().optional(),
  outputStereo: z.boolean().optional(),
})

const voicevoxVoiceSchema = synthesisParamsSchema.extend({
  emotion: z.string().min(1).default('neutral'),
  speakerId: z.number().int().nonnegative(),
})

export const audioProfileSchema = synthesisParamsSchema.extend({
  ttsEngine: z.literal('voicevox'),
  voicevoxUrl: z.string().min(1),
  speakerId: z.number().int().nonnegative().default(1),
  voices: z.array(voicevoxVoiceSchema).optional(),
})

// STT設定スキーマ（トップレベル）- OpenAI互換API
export const sttConfigSchema = z.object({
  baseUrl: z.string().min(1).default('http://localhost:8000/v1'),
  apiKey: z.string().optional(),
  model: z.string().min(1).default('whisper-1'),
  language: z.string().min(1).default('ja'),
})

const presetSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1).optional(),
  actions: z.array(actionSchema).default([]),
  idleMotions: sizedMotionSchema,
  speechMotions: sizedMotionSchema,
  speechTransitions: z
    .object({
      enter: transitionCollectionSchema.optional(),
      exit: transitionCollectionSchema.optional(),
    })
    .optional(),
  audioProfile: audioProfileSchema,
})

export const configSchema = z.object({
  server: z
    .object({
      port: z.number().int().positive().default(4000),
      host: z.string().min(1).default('localhost'),
      apiKey: z.string().min(1).optional(),
    })
    .default({ port: 4000, host: 'localhost' }),
  rtmp: z
    .object({
      outputUrl: z.string().min(1).default('rtmp://127.0.0.1:1936/live/main'),
    })
    .default({ outputUrl: 'rtmp://127.0.0.1:1936/live/main' }),
  stt: sttConfigSchema.optional(),
  presets: z.array(presetSchema).min(1),
})

export type StreamerConfig = z.infer<typeof configSchema>
export type MotionType = z.infer<typeof motionTypeSchema>
