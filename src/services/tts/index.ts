// Types
export type {
  TtsEngineType,
  TtsEngine,
  TtsSynthesisParams,
  TtsSynthesizeOptions,
  TtsVoiceProfile,
  VoicevoxVoiceProfile,
  OpenAiVoiceProfile,
  ElevenLabsVoiceProfile,
  StyleBertVits2VoiceProfile,
  GoogleTtsVoiceProfile,
  AzureTtsVoiceProfile,
} from './types'

// Schema
export {
  ttsEngineTypeSchema,
  audioProfileSchema,
  voicevoxAudioProfileSchema,
  styleBertVits2AudioProfileSchema,
  openAiAudioProfileSchema,
  googleAudioProfileSchema,
  azureAudioProfileSchema,
  elevenLabsAudioProfileSchema,
  synthesisParamsSchema,
} from './schema'

export type {
  AudioProfile,
  VoicevoxAudioProfile,
  StyleBertVits2AudioProfile,
  OpenAiAudioProfile,
  GoogleAudioProfile,
  AzureAudioProfile,
  ElevenLabsAudioProfile,
} from './schema'

// Engines
export {
  VoicevoxCompatibleEngine,
  OpenAiTtsEngine,
  StyleBertVits2Engine,
  ElevenLabsEngine,
  GoogleTtsEngine,
  AzureTtsEngine,
} from './engines'

// Factory
export { createTtsEngine } from './factory'
