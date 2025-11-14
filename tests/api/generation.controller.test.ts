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

  const createApp = (processBatch: (payload: unknown, handler?: any) => Promise<any>, apiKey?: string) => {
    const service = { processBatch }
    const app = express()
    app.use(express.json())
    app.use('/api', createGenerationRouter(service as any, { apiKey }))
    return app
  }

  it('returns combined result for non-stream requests', async () => {
    const app = createApp(async () => ({
      kind: 'combined',
      result: { outputPath: '/tmp/out.mp4', durationMs: 2000, motionIds: ['a', 'b'] },
    }))

    const response = await request(app)
      .post('/api/generate')
      .send({ characterId: 'anchor-a', stream: false, debug: true, requests: [{ action: 'speak', params: { text: 'hello' } }] })

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
      .send({ characterId: 'anchor-a', requests: [{ action: 'idle', params: { durationMs: 500 } }] })

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
      .send({ characterId: 'anchor-a', stream: true, debug: true, requests: [{ action: 'idle', params: { durationMs: 300 } }] })

    expect(response.status).toBe(200)
    expect(response.text).toContain('"type":"result"')
    expect(response.text).toContain('"type":"done"')
    expect(response.text).toContain('"motionIds":["idle"]')
  })

  it('returns NDJSON error chunk when ActionProcessingError occurs during streaming', async () => {
    const app = createApp(async () => {
      throw new ActionProcessingError('stream error', '9', 418)
    })

    const response = await request(app)
      .post('/api/generate')
      .send({ characterId: 'anchor-a', stream: true, requests: [{ action: 'idle', params: { durationMs: 100 } }] })

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
      .send({ characterId: 'anchor-a', requests: [{ action: 'idle', params: { durationMs: 200 } }] })

    expect(response.status).toBe(500)
    expect(response.body).toEqual({ message: 'Internal Server Error' })
  })

  it('handles unexpected errors in streaming mode by emitting error chunk', async () => {
    const app = createApp(async () => {
      throw new TypeError('boom')
    })

    const response = await request(app)
      .post('/api/generate')
      .send({ characterId: 'anchor-a', stream: true, requests: [{ action: 'idle', params: { durationMs: 100 } }] })

    expect(response.status).toBe(200)
    expect(response.text).toContain('"type":"error"')
    expect(response.text).toContain('Internal Server Error')
  })

  it('returns 401 when API key is required but missing', async () => {
    const processBatch = vi.fn()
    const app = createApp(processBatch as any, 'secret')

    const response = await request(app)
      .post('/api/generate')
      .send({ characterId: 'anchor-a', requests: [{ action: 'idle', params: { durationMs: 200 } }] })

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ message: 'Invalid API key' })
    expect(processBatch).not.toHaveBeenCalled()
  })

  it('returns 401 when API key does not match', async () => {
    const processBatch = vi.fn()
    const app = createApp(processBatch as any, 'secret')

    const response = await request(app)
      .post('/api/generate')
      .set('X-API-Key', 'invalid')
      .send({ characterId: 'anchor-a', requests: [{ action: 'idle', params: { durationMs: 200 } }] })

    expect(response.status).toBe(401)
    expect(response.body).toEqual({ message: 'Invalid API key' })
    expect(processBatch).not.toHaveBeenCalled()
  })

  it('allows requests when API key matches', async () => {
    const app = createApp(async () => ({
      kind: 'combined',
      result: { outputPath: '/tmp/out.mp4', durationMs: 200, motionIds: [] },
    }), 'secret')

    const response = await request(app)
      .post('/api/generate')
      .set('X-API-Key', 'secret')
      .send({ characterId: 'anchor-a', stream: false, debug: false, requests: [{ action: 'idle', params: { durationMs: 200 } }] })

    expect(response.status).toBe(200)
  })
})
