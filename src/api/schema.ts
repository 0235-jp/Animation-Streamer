import { z } from 'zod'

export const generateRequestSchema = z.object({
  stream: z.boolean().optional(),
  defaults: z
    .object({
      emotion: z.string().min(1).optional(),
      idleMotionId: z.string().min(1).optional(),
    })
    .optional(),
  requests: z
    .array(
      z.object({
        action: z.string().min(1),
        params: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .min(1),
  metadata: z.record(z.string(), z.unknown()).optional(),
})
