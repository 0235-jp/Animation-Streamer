import express, { Router } from 'express'
import { z } from 'zod'
import { StreamService } from '../services/stream.service'
import { streamTextRequestSchema } from './schema'

const startSchema = z.object({
  presetId: z.string().min(1),
  debug: z.boolean().optional().default(false),
})

export interface StreamRouterOptions {
  apiKey?: string
}

export const createStreamRouter = (streamService: StreamService, options: StreamRouterOptions = {}): Router => {
  const router = Router()
  const { apiKey } = options

  if (apiKey) {
    router.use((req, res, next) => {
      const providedKey = req.header('x-api-key')
      if (providedKey !== apiKey) {
        return res.status(401).json({ message: 'Invalid API key' })
      }
      return next()
    })
  }

  router.post('/stream/start', async (req, res) => {
    const parsed = startSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return res.status(400).json({ message: 'presetId is required' })
    }
    try {
      const { presetId, debug } = parsed.data
      const state = await streamService.start(presetId, { debug })
      return res.json({ status: state.phase, sessionId: state.sessionId, currentMotionId: state.activeMotionId, presetId: state.presetId })
    } catch (error) {
      const statusCode = (error as any).statusCode ?? 500
      return res.status(statusCode).json({ message: (error as Error).message })
    }
  })

  router.post('/stream/stop', (_req, res) => {
    const state = streamService.stop()
    return res.json({ status: state.phase })
  })

  const handleStatus = (_req: express.Request, res: express.Response) => {
    const state = streamService.status()
    return res.json({
      status: state.phase,
      sessionId: state.sessionId,
      currentMotionId: state.activeMotionId,
      queueLength: state.queueLength,
      presetId: state.presetId,
    })
  }

  router.get('/stream/status', handleStatus)
  router.get('/status', handleStatus)

  router.post('/stream/text', (req, res) => {
    const parsed = streamTextRequestSchema.safeParse(req.body ?? {})
    if (!parsed.success) {
      return res.status(400).json({ message: 'Invalid request', issues: parsed.error.issues })
    }
    streamService
      .enqueueText(parsed.data)
      .then(() => res.status(202).json({ ok: true }))
      .catch((error) => {
        const statusCode = (error as any).statusCode ?? 500
        return res.status(statusCode).json({ message: (error as Error).message })
      })
  })

  return router
}
