import { z } from 'zod'

/** 共通の音声合成パラメータスキーマ */
export const synthesisParamsSchema = z.object({
  speedScale: z.number().positive().optional(),
  pitchScale: z.number().optional(),
  intonationScale: z.number().nonnegative().optional(),
  volumeScale: z.number().nonnegative().optional(),
  outputSamplingRate: z.number().int().positive().optional(),
  outputStereo: z.boolean().optional(),
})

/** TTSエンジンの種類 */
export const ttsEngineTypeSchema = z.enum([
  'voicevox',
  'coeiroink',
  'aivis_speech',
  'style_bert_vits2',
  'openai',
  'google',
  'azure',
  'elevenlabs',
])

// ============================================
// VOICEVOX互換エンジン (voicevox, coeiroink, aivis_speech)
// ============================================

const voicevoxVoiceSchema = synthesisParamsSchema.extend({
  emotion: z.string().min(1).default('neutral'),
  speakerId: z.number().int().nonnegative(),
})

/** VOICEVOX互換エンジンの設定（後方互換性のためvoicevoxUrlも受け入れ） */
const voicevoxAudioProfileBaseSchema = synthesisParamsSchema.extend({
  ttsEngine: z.enum(['voicevox', 'coeiroink', 'aivis_speech']),
  url: z.string().min(1).optional(),
  voicevoxUrl: z.string().min(1).optional(), // 後方互換性
  speakerId: z.number().int().nonnegative().default(1),
  voices: z.array(voicevoxVoiceSchema).optional(),
})

export const voicevoxAudioProfileSchema = voicevoxAudioProfileBaseSchema.transform((data) => {
  // voicevoxUrl を url に正規化（後方互換性）
  const url = data.url ?? data.voicevoxUrl
  if (!url) {
    throw new Error(`${data.ttsEngine}: url または voicevoxUrl が必要です`)
  }
  const { voicevoxUrl: _, ...rest } = data
  return { ...rest, url }
})

// ============================================
// Style-Bert-VITS2
// ============================================

const styleBertVits2VoiceSchema = synthesisParamsSchema.extend({
  emotion: z.string().min(1).default('neutral'),
  modelName: z.string().min(1),
  language: z.string().min(1).optional(),
  style: z.string().optional(),
  styleWeight: z.number().min(0).max(1).optional(),
})

export const styleBertVits2AudioProfileSchema = synthesisParamsSchema.extend({
  ttsEngine: z.literal('style_bert_vits2'),
  url: z.string().min(1),
  modelName: z.string().min(1),
  language: z.string().min(1),
  style: z.string().optional(),
  styleWeight: z.number().min(0).max(1).optional(),
  voices: z.array(styleBertVits2VoiceSchema).optional(),
})

// ============================================
// OpenAI TTS
// ============================================

const openAiVoiceNameSchema = z.enum(['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'])

const openAiVoiceSchema = synthesisParamsSchema.extend({
  emotion: z.string().min(1).default('neutral'),
  voice: openAiVoiceNameSchema,
  model: z.enum(['tts-1', 'tts-1-hd']).optional(),
})

export const openAiAudioProfileSchema = synthesisParamsSchema.extend({
  ttsEngine: z.literal('openai'),
  apiKey: z.string().min(1),
  voice: openAiVoiceNameSchema, // 必須
  model: z.enum(['tts-1', 'tts-1-hd']), // 必須
  voices: z.array(openAiVoiceSchema).optional(),
})

// ============================================
// Google Cloud TTS
// ============================================

const googleVoiceSchema = synthesisParamsSchema.extend({
  emotion: z.string().min(1).default('neutral'),
  languageCode: z.string().min(1),
  voiceName: z.string().min(1),
})

export const googleAudioProfileSchema = synthesisParamsSchema
  .extend({
    ttsEngine: z.literal('google'),
    apiKey: z.string().min(1).optional(),
    credentialsPath: z.string().min(1).optional(),
    languageCode: z.string().min(1),
    voiceName: z.string().min(1),
    voices: z.array(googleVoiceSchema).optional(),
  })
  .refine((data) => data.apiKey || data.credentialsPath, {
    message: 'Google TTS: apiKey または credentialsPath のいずれかが必要です',
  })

// ============================================
// Azure TTS
// ============================================

const azureVoiceSchema = synthesisParamsSchema.extend({
  emotion: z.string().min(1).default('neutral'),
  voiceName: z.string().min(1),
  languageCode: z.string().min(1).optional(),
  style: z.string().optional(),
  styleDegree: z.number().min(0.01).max(2).optional(),
})

export const azureAudioProfileSchema = synthesisParamsSchema.extend({
  ttsEngine: z.literal('azure'),
  subscriptionKey: z.string().min(1),
  region: z.string().min(1),
  languageCode: z.string().min(1),
  voiceName: z.string().min(1),
  voices: z.array(azureVoiceSchema).optional(),
})

// ============================================
// ElevenLabs
// ============================================

const elevenLabsVoiceSchema = synthesisParamsSchema.extend({
  emotion: z.string().min(1).default('neutral'),
  voiceId: z.string().min(1),
  modelId: z.string().optional(),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
})

export const elevenLabsAudioProfileSchema = synthesisParamsSchema.extend({
  ttsEngine: z.literal('elevenlabs'),
  apiKey: z.string().min(1),
  voiceId: z.string().min(1),
  modelId: z.string().min(1),
  stability: z.number().min(0).max(1).optional(),
  similarityBoost: z.number().min(0).max(1).optional(),
  voices: z.array(elevenLabsVoiceSchema).optional(),
})

// ============================================
// 統合スキーマ
// ============================================

/** すべてのTTSエンジンの設定を包含するUnion型 */
export const audioProfileSchema = z.discriminatedUnion('ttsEngine', [
  voicevoxAudioProfileSchema,
  styleBertVits2AudioProfileSchema,
  openAiAudioProfileSchema,
  googleAudioProfileSchema,
  azureAudioProfileSchema,
  elevenLabsAudioProfileSchema,
])

export type TtsEngineType = z.infer<typeof ttsEngineTypeSchema>
export type AudioProfile = z.infer<typeof audioProfileSchema>
export type VoicevoxAudioProfile = z.infer<typeof voicevoxAudioProfileSchema>
export type StyleBertVits2AudioProfile = z.infer<typeof styleBertVits2AudioProfileSchema>
export type OpenAiAudioProfile = z.infer<typeof openAiAudioProfileSchema>
export type GoogleAudioProfile = z.infer<typeof googleAudioProfileSchema>
export type AzureAudioProfile = z.infer<typeof azureAudioProfileSchema>
export type ElevenLabsAudioProfile = z.infer<typeof elevenLabsAudioProfileSchema>
