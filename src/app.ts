import express from 'express'
import path from 'node:path'
import { loadConfig, type ResolvedConfig } from './config/loader'
import { MediaPipeline } from './services/media-pipeline'
import { ClipPlanner } from './services/clip-planner'
import { VoicevoxClient } from './services/voicevox'
import { GenerationService } from './services/generation.service'
import { createGenerationRouter } from './api/generation.controller'
import { createDocsRouter } from './api/docs'

export interface CreateAppOptions {
  configPath?: string
}

export const createApp = async (options: CreateAppOptions = {}) => {
  const configPath = options.configPath ?? path.resolve(process.cwd(), 'config/stream-profile.json')
  const config = await loadConfig(configPath)

  const mediaPipeline = new MediaPipeline(config.paths.outputDir)
  const clipPlanner = new ClipPlanner(mediaPipeline, config.characters)
  const voicevox = new VoicevoxClient()
  const generationService = new GenerationService({
    config,
    clipPlanner,
    mediaPipeline,
    voicevox,
  })

  const app = express()
  app.use(express.json({ limit: '2mb' }))
  app.use('/api', createGenerationRouter(generationService, { apiKey: config.server.apiKey }))
  app.use('/docs', createDocsRouter())
  app.get('/health', (_req, res) => res.json({ status: 'ok' }))

  return { app, config }
}

export type { ResolvedConfig }
