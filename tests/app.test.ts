import path from 'node:path'
import request from 'supertest'
import { describe, it, expect, vi } from 'vitest'
import { createApp } from '../src/app'
import * as loader from '../src/config/loader'

describe('createApp', () => {
  it('loads config from provided path and wires health endpoint', async () => {
    const spy = vi.spyOn(loader, 'loadConfig')
    const configPath = path.resolve(process.cwd(), 'config/example.stream-profile.json')

    const { app, config } = await createApp({ configPath })
    const response = await request(app).get('/health')

    expect(spy).toHaveBeenCalledWith(configPath)
    expect(response.status).toBe(200)
    expect(response.body).toEqual({ status: 'ok' })
    expect(config.assets.absoluteTempDir).toContain(path.join('config', 'tmp'))
  })
})
