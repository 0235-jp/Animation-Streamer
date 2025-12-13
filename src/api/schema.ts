import { z } from 'zod'

/**
 * speak アクションの音声入力スキーマ
 * path または base64 のいずれか一方を指定
 */
export const audioInputSchema = z
  .object({
    path: z.string().min(1).optional(),
    base64: z.string().min(1).optional(),
    transcribe: z.boolean().optional(),
  })
  .refine((data) => (data.path !== undefined) !== (data.base64 !== undefined), {
    message: 'audio には path または base64 のいずれか一方を指定してください',
  })

/**
 * speak アクションのパラメータスキーマ
 * text または audio のいずれか一方を指定（排他）
 */
export const speakParamsSchema = z
  .object({
    text: z.string().optional(),
    audio: audioInputSchema.optional(),
    emotion: z.string().optional(),
  })
  .refine(
    (data) => {
      const hasText = data.text !== undefined && data.text.trim() !== ''
      const hasAudio = data.audio !== undefined
      return hasText !== hasAudio // XOR: どちらか一方のみ
    },
    {
      message: 'text または audio のいずれか一方を指定してください',
    }
  )

export const generateRequestSchema = z.object({
  presetId: z.string().min(1),
  stream: z.boolean().optional(),
  cache: z.boolean().optional(),
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
