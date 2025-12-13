import express from 'express'
import path from 'node:path'
import { loadConfig, type ResolvedConfig } from './config/loader'
import { MediaPipeline } from './services/media-pipeline'
import { ClipPlanner } from './services/clip-planner'
import { VoicevoxClient } from './services/voicevox'
import { StyleBertVits2Client } from './services/style-bert-vits2'
import { CacheService } from './services/cache.service'
import { GenerationService } from './services/generation.service'
import { createGenerationRouter } from './api/generation.controller'
import { createDocsRouter } from './api/docs'
import { StreamService } from './services/stream.service'
import { createStreamRouter } from './api/stream.controller'
import { RtmpServer } from './infra/rtmp-server'
import { logger } from './utils/logger'

export interface CreateAppOptions {
  configPath?: string
}

export const createApp = async (options: CreateAppOptions = {}) => {
  const configPath = options.configPath ?? path.resolve(process.cwd(), 'config/stream-profile.json')
  const config = await loadConfig(configPath)

  const mediaPipeline = new MediaPipeline(config.paths.outputDir)
  const clipPlanner = new ClipPlanner(mediaPipeline, config.presets)

  await clipPlanner.validateMotionSpecs(config.presets)
  const voicevox = new VoicevoxClient()
  const sbv2 = new StyleBertVits2Client()
  const cacheService = new CacheService(config.paths.outputDir)

  // 起動時にログファイルを実態と同期（失敗しても起動は継続）
  try {
    await cacheService.syncLogWithFiles()
  } catch (err) {
    logger.warn({ err }, 'Failed to sync output log; continuing startup')
  }

  const generationService = new GenerationService({
    config,
    clipPlanner,
    mediaPipeline,
    voicevox,
    sbv2,
    cacheService,
  })

  const app = express()
  app.use(express.json({ limit: '2mb' }))

  const rtmpServer = new RtmpServer({ outputUrl: config.rtmp.outputUrl })
  rtmpServer.start()
  const streamService = new StreamService(config, clipPlanner, mediaPipeline, generationService)

  app.use('/api', createGenerationRouter(generationService, { apiKey: config.server.apiKey }))
  app.use('/api', createStreamRouter(streamService, { apiKey: config.server.apiKey }))
  app.use('/docs', createDocsRouter())
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))

  return { app, config }
}

export type { ResolvedConfig }
