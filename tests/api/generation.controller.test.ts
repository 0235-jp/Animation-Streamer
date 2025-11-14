import express from 'express'
import request from 'supertest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createGenerationRouter } from '../../src/api/generation.controller'
import { ActionProcessingError } from '../../src/services/generation.service'
import { logger } from '../../src/utils/logger'

describe('createGenerationRouter', () => {
  beforeEach(() => {
    vi.spyOn(logger, 'warn').mockReturnValue(undefined)
    vi.spyOn(logger, 'error').mockReturnValue(undefined)
  })

  const createApp = (processBatch: (payload: unknown, handler?: any) => Promise<any>) => {
    const service = { processBatch }
    const app = express()
    app.use(express.json())
    app.use('/api', createGenerationRouter(service as any))
    return app
  }

  it('returns combined result for non-stream requests', async () => {
    const app = createApp(async () => ({
      kind: 'combined',
      result: { outputPath: '/tmp/out.mp4', durationMs: 2000, motionIds: ['a', 'b'] },
    }))

    const response = await request(app)
      .post('/api/generate')
      .send({ stream: false, debug: true, requests: [{ action: 'speak', params: { text: 'hello' } }] })

    expect(response.status).toBe(200)
    expect(response.body).toEqual({ outputPath: '/tmp/out.mp4', durationMs: 2000, motionIds: ['a', 'b'] })
  })

  it('validates body with zod and returns 400 on error', async () => {
    const app = createApp(async () => {
      throw new Error('should not reach')
    })

    const response = await request(app).post('/api/generate').send({})

    expect(response.status).toBe(400)
    expect(response.body.message).toBe('Invalid request')
  })

  it('maps ActionProcessingError to response status and payload', async () => {
    const app = createApp(async () => {
      throw new ActionProcessingError('bad request', '1', 422)
    })

    const response = await request(app)
      .post('/api/generate')
      .send({ requests: [{ action: 'idle', params: { durationMs: 500 } }] })

    expect(response.status).toBe(422)
    expect(response.body).toEqual({ message: 'bad request', id: '1' })
  })

  it('streams NDJSON chunks for stream requests', async () => {
    const actionResult = {
      id: '1',
      action: 'idle',
      outputPath: '/tmp/out.mp4',
      durationMs: 400,
      motionIds: ['idle'],
    }
    const app = createApp(async (_payload, handler) => {
      await handler?.onResult?.(actionResult)
      return { kind: 'stream', results: [actionResult] }
    })

    const response = await request(app)
      .post('/api/generate')
      .send({ stream: true, debug: true, requests: [{ action: 'idle', params: { durationMs: 300 } }] })

    expect(response.status).toBe(200)
    expect(response.text).toContain('"type":"result"')
    expect(response.text).toContain('"type":"done"')
    expect(response.text).toContain('"motionIds":["idle"]')
  })

  it('streams progress events before results in streaming mode', async () => {
    const actionProgress = { id: '1', action: 'speak', status: 'started' as const }
    const actionResult = {
      id: '1',
      action: 'speak',
      outputPath: '/tmp/out.mp4',
      durationMs: 1200,
    }
    const app = createApp(async (_payload, handler) => {
      await handler?.onProgress?.(actionProgress)
      await handler?.onResult?.(actionResult)
      return { kind: 'stream', results: [actionResult] }
    })

    const response = await request(app)
      .post('/api/generate')
      .send({ stream: true, requests: [{ action: 'speak', params: { text: 'test' } }] })

    expect(response.status).toBe(200)
    expect(response.text).toContain('"type":"progress"')
    expect(response.text).toContain('"status":"started"')
    expect(response.text).toContain('"type":"result"')
    expect(response.text).toContain('"type":"done"')
    const lines = response.text.trim().split('\n')
    const firstEvent = JSON.parse(lines[0])
    expect(firstEvent.type).toBe('progress')
  })

  it('returns NDJSON error chunk when ActionProcessingError occurs during streaming', async () => {
    const app = createApp(async () => {
      throw new ActionProcessingError('stream error', '9', 418)
    })

    const response = await request(app)
      .post('/api/generate')
      .send({ stream: true, requests: [{ action: 'idle', params: { durationMs: 100 } }] })

    expect(response.status).toBe(200)
    expect(response.text).toContain('"type":"error"')
    expect(response.text).toContain('"message":"stream error"')
  })

  it('handles unexpected errors with 500 status for non-stream requests', async () => {
    const app = createApp(async () => {
      throw new Error('boom')
    })

    const response = await request(app)
      .post('/api/generate')
      .send({ requests: [{ action: 'idle', params: { durationMs: 200 } }] })

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ message: 'Internal Server Error' })
  })

  it('handles unexpected errors in streaming mode by emitting error chunk', async () => {
    const app = createApp(async () => {
      throw new TypeError('boom')
    })

    const response = await request(app)
      .post('/api/generate')
      .send({ stream: true, requests: [{ action: 'idle', params: { durationMs: 100 } }] })

    expect(response.status).toBe(200)
    expect(response.text).toContain('"type":"error"')
    expect(response.text).toContain('Internal Server Error')
  })
})
