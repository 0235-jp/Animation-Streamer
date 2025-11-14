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

export const audioProfileSchema = z.object({
  ttsEngine: z.literal('voicevox'),
  voicevoxUrl: z.string().min(1),
  speakerId: z.number().int().nonnegative().default(1),
  speedScale: z.number().positive().optional(),
  pitchScale: z.number().optional(),
  intonationScale: z.number().nonnegative().optional(),
  volumeScale: z.number().nonnegative().optional(),
  outputSamplingRate: z.number().int().positive().optional(),
  outputStereo: z.boolean().optional(),
})

export const configSchema = z.object({
  server: z
    .object({
      port: z.number().int().positive().default(4000),
    })
    .default({ port: 4000 }),
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
  assets: z.object({
    tempDir: z.string().min(1),
  }),
})

export type StreamerConfig = z.infer<typeof configSchema>
export type MotionType = z.infer<typeof motionTypeSchema>
