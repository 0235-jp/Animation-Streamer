import { z } from 'zod'
import { audioProfileSchema } from '../services/tts/schema'

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

// audioProfileSchemaは ../services/tts/schema からインポート
// 複数のTTSエンジン（VOICEVOX, COEIROINK, AivisSpeech, OpenAI, Google, Azure, ElevenLabs等）に対応
export { audioProfileSchema }

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
  presets: z.array(presetSchema).min(1),
})

export type StreamerConfig = z.infer<typeof configSchema>
export type MotionType = z.infer<typeof motionTypeSchema>
