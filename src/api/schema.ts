import { z } from 'zod'

export const generateRequestSchema = z.object({
  presetId: z.string().min(1),
  stream: z.boolean().optional(),
  requests: z
    .array(
      z.object({
        action: z.string().min(1),
        params: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1),
  debug: z.boolean().optional(),
})

// /stream/text用のスキーマ（streamは常にtrue）
export const streamTextRequestSchema = z.object({
  presetId: z.string().min(1),
  requests: z
    .array(
      z.object({
        action: z.string().min(1),
        params: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1),
  debug: z.boolean().optional(),
})
