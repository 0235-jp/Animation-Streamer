import { Router } from 'express'
import { ZodError } from 'zod'
import { generateRequestSchema } from './schema'
import { GenerationService, ActionProcessingError } from '../services/generation.service'
import type { GenerateRequestPayload } from '../types/generate'
import { logger } from '../utils/logger'

const toNdjson = (payload: unknown) => `${JSON.stringify(payload)}\n`

export const createGenerationRouter = (generationService: GenerationService): Router => {
  const router = Router()

  router.post('/generate', async (req, res) => {
    let payload: GenerateRequestPayload
    try {
      payload = generateRequestSchema.parse(req.body)
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({ message: 'Invalid request', issues: error.issues })
      }
      return res.status(400).json({ message: error instanceof Error ? error.message : 'Invalid request' })
    }

    if (payload.stream) {
      res.setHeader('Content-Type', 'application/x-ndjson')
      res.setHeader('Transfer-Encoding', 'chunked')
    }

    try {
      const batchResult = await generationService.processBatch(
        payload,
        payload.stream
          ? {
              onResult: (result) => {
                res.write(toNdjson({ type: 'result', result }))
              },
            }
          : undefined
      )

      if (batchResult.kind === 'stream') {
        res.write(toNdjson({ type: 'done', count: batchResult.results.length }))
        return res.end()
      }
      return res.json(batchResult.result)
    } catch (error) {
      if (error instanceof ActionProcessingError) {
        logger.warn({ err: error, requestId: error.requestId }, 'Generation error')
        if (payload.stream) {
          res.write(toNdjson({ type: 'error', id: error.requestId, message: error.message }))
          return res.end()
        }
        return res.status(error.statusCode).json({
          message: error.message,
          id: error.requestId,
        })
      }

      logger.error({ err: error }, 'Unexpected error on /api/generate')
      if (payload.stream) {
        res.write(toNdjson({ type: 'error', message: 'Internal Server Error' }))
        return res.end()
      }
      return res.status(500).json({ message: 'Internal Server Error' })
    }
  })

  return router
}
