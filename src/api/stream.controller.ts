import { Router } from 'express'
import { z, ZodError } from 'zod'
import { logger } from '../utils/logger'
import { StreamService } from '../services/stream.service'

const startRequestSchema = z.object({
  sessionToken: z.string().optional(),
})

const textRequestSchema = z.object({
  text: z.string().min(1),
  motionId: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
})

export const createStreamRouter = (streamService: StreamService): Router => {
  const router = Router()

  router.post('/start', async (req, res) => {
    try {
      const request = startRequestSchema.parse(req.body)
      const response = await streamService.start(request)
      res.json(response)
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ err: error }, 'Invalid start request')
        return res.status(400).json({ message: 'Invalid request', issues: error.issues })
      }
      logger.error({ err: error }, 'Error starting stream')
      return res.status(500).json({ message: 'Internal Server Error' })
    }
  })

  router.post('/stop', async (req, res) => {
    try {
      const response = await streamService.stop()
      res.json(response)
    } catch (error) {
      logger.error({ err: error }, 'Error stopping stream')
      return res.status(500).json({ message: 'Internal Server Error' })
    }
  })

  router.get('/status', (req, res) => {
    try {
      const status = streamService.getStatus()
      res.json(status)
    } catch (error) {
      logger.error({ err: error }, 'Error getting status')
      return res.status(500).json({ message: 'Internal Server Error' })
    }
  })

  router.post('/text', async (req, res) => {
    try {
      const request = textRequestSchema.parse(req.body)

      // Phase 1: Return 501 Not Implemented
      // Phase 3 will implement: await streamService.enqueueText(request)
      logger.info({ request }, 'Text endpoint called (not implemented)')
      return res.status(501).json({ message: 'Not Implemented' })
    } catch (error) {
      if (error instanceof ZodError) {
        logger.warn({ err: error }, 'Invalid text request')
        return res.status(400).json({ message: 'Invalid request', issues: error.issues })
      }
      logger.error({ err: error }, 'Error processing text')
      return res.status(500).json({ message: 'Internal Server Error' })
    }
  })

  return router
}
