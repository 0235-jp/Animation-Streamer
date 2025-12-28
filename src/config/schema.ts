import { z } from 'zod'

export const motionTypeSchema = z.enum(['large', 'small'])

export const actionSchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
})

const motionVariantSchema = z.object({
  id: z.string().min(1),
  emotion: z.string().min(1).default('neutral'),
  path: z.string().min(1),
})

export const sizedMotionSchema = z.object({
  large: z.array(motionVariantSchema).min(1),
  small: z.array(motionVariantSchema).min(1),
})

export const transitionMotionSchema = z.object({
  id: z.string().min(1),
  emotion: z.string().min(1).default('neutral'),
  path: z.string().min(1),
})
const transitionCollectionSchema = z.union([transitionMotionSchema, z.array(transitionMotionSchema).min(1)])

// VOICEVOX用パラメータスキーマ
const voicevoxSynthesisParamsSchema = z.object({
  speedScale: z.number().positive().optional(),
  pitchScale: z.number().optional(),
  intonationScale: z.number().nonnegative().optional(),
  volumeScale: z.number().nonnegative().optional(),
  outputSamplingRate: z.number().int().positive().optional(),
  outputStereo: z.boolean().optional(),
})

const voicevoxVoiceSchema = voicevoxSynthesisParamsSchema.extend({
  emotion: z.string().min(1).default('neutral'),
  speakerId: z.number().int().nonnegative(),
})

const voicevoxAudioProfileSchema = z.object({
  ttsEngine: z.literal('voicevox'),
  voicevoxUrl: z.string().min(1),
  voices: z.array(voicevoxVoiceSchema).optional(),
})

// Style-Bert-VITS2用パラメータスキーマ
const sbv2SynthesisParamsSchema = z.object({
  sdpRatio: z.number().min(0).max(1).optional(),
  noise: z.number().min(0).max(1).optional(),
  noisew: z.number().min(0).max(1).optional(),
  length: z.number().positive().optional(),
  language: z.string().optional(),
  style: z.string().optional(),
  styleWeight: z.number().optional(),
  assistText: z.string().optional(),
  assistTextWeight: z.number().optional(),
  autoSplit: z.boolean().optional(),
  splitInterval: z.number().nonnegative().optional(),
  referenceAudioPath: z.string().optional(),
})

const sbv2VoiceSchema = sbv2SynthesisParamsSchema.extend({
  emotion: z.string().min(1).default('neutral'),
  modelId: z.number().int().nonnegative().optional(),
  modelName: z.string().optional(),
  speakerId: z.number().int().nonnegative().optional(),
  speakerName: z.string().optional(),
})

const sbv2AudioProfileSchema = z.object({
  ttsEngine: z.literal('style-bert-vits2'),
  sbv2Url: z.string().min(1),
  voices: z.array(sbv2VoiceSchema).optional(),
})

// 統合audioProfileスキーマ
export const audioProfileSchema = z.discriminatedUnion('ttsEngine', [
  voicevoxAudioProfileSchema,
  sbv2AudioProfileSchema,
])

// リップシンク用画像セットスキーマ（aiueoN形式 - 日本語母音ベース）
const lipSyncImagesSchema = z.object({
  A: z.string().min(1), // あ - 大きく開いた口
  I: z.string().min(1), // い - 横に広がった口
  U: z.string().min(1), // う - すぼめた口
  E: z.string().min(1), // え - 中間的に開いた口
  O: z.string().min(1), // お - 丸く開いた口
  N: z.string().min(1), // ん/無音 - 閉じた口
})

// 口画像オーバーレイ設定スキーマ
const mouthOverlayConfigSchema = z.object({
  scale: z.number().positive().default(1.0), // 口画像のスケール倍率
  offsetX: z.number().default(0), // X軸オフセット（ピクセル）
  offsetY: z.number().default(0), // Y軸オフセット（ピクセル）
})

const lipSyncVariantSchema = z.object({
  id: z.string().min(1),
  emotion: z.string().min(1).default('neutral'),
  images: lipSyncImagesSchema,
  // オーバーレイ合成用の設定
  basePath: z.string().min(1), // ベース動画パス（ループ動画）
  mouthDataPath: z.string().min(1), // 口位置JSONパス（Python出力）
  overlayConfig: mouthOverlayConfigSchema.optional(),
})

// speechMotions と同じ large/small 構造
export const sizedLipSyncSchema = z.object({
  large: z.array(lipSyncVariantSchema).min(1),
  small: z.array(lipSyncVariantSchema).optional(), // small は省略可能
})

// STT設定スキーマ（トップレベル）- OpenAI互換API
export const sttConfigSchema = z.object({
  baseUrl: z.string().min(1).default('http://localhost:8000/v1'),
  apiKey: z.string().optional(),
  model: z.string().min(1).default('whisper-1'),
  language: z.string().min(1).default('ja'),
})

const presetSchema = z
  .object({
    id: z.string().min(1),
    displayName: z.string().min(1).optional(),
    actions: z.array(actionSchema).default([]),
    idleMotions: sizedMotionSchema,
    speechMotions: sizedMotionSchema.optional(),
    speechTransitions: z
      .object({
        enter: transitionCollectionSchema.optional(),
        exit: transitionCollectionSchema.optional(),
      })
      .optional(),
    audioProfile: audioProfileSchema,
    lipSync: sizedLipSyncSchema.optional(),
  })
  .refine((data) => data.speechMotions || data.lipSync, {
    message: 'speechMotions または lipSync のどちらかを設定してください',
    path: ['speechMotions'],
  })

export const configSchema = z.object({
  server: z
    .object({
      port: z.number().int().positive().default(4000),
      host: z.string().min(1).default('localhost'),
      apiKey: z.string().min(1).optional(),
    })
    .default({ port: 4000, host: 'localhost' }),
  rtmp: z
    .object({
      outputUrl: z.string().min(1).default('rtmp://127.0.0.1:1936/live/main'),
    })
    .default({ outputUrl: 'rtmp://127.0.0.1:1936/live/main' }),
  stt: sttConfigSchema.optional(),
  presets: z.array(presetSchema).min(1),
})

export type StreamerConfig = z.infer<typeof configSchema>
export type MotionType = z.infer<typeof motionTypeSchema>
