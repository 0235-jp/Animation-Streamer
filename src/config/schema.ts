import { z } from 'zod';

const motionSchema = z.object({
  id: z.string().min(1, 'motion id is required'),
  path: z.string().min(1, 'motion path is required')
});

const serverSchema = z.object({
  port: z.number().int().min(1, 'server.port must be >= 1').max(65535, 'server.port must be <= 65535').default(4000)
});

const audioProfileSchema = z.object({
  ttsEngine: z.literal('voicevox'),
  voicevoxUrl: z.string().url('voicevoxUrl must be a valid URL'),
  speakerId: z.number().nonnegative()
});

export const streamProfileSchema = z.object({
  server: serverSchema.default({ port: 4000 }),
  rtmp: z.object({
    outputUrl: z.string().min(1, 'rtmp.outputUrl is required')
  }),
  waitingMotions: z.array(motionSchema).min(1, 'at least one waiting motion is required'),
  speechMotions: z.array(motionSchema).default([]),
  audioProfile: audioProfileSchema,
  assets: z.object({
    tempDir: z.string().min(1, 'assets.tempDir is required')
  })
});

export type RawStreamProfile = z.infer<typeof streamProfileSchema>;
