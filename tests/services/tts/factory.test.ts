import { describe, it, expect } from 'vitest'
import { createTtsEngine } from '../../../src/services/tts/factory'
import { VoicevoxCompatibleEngine } from '../../../src/services/tts/engines/voicevox-compatible'
import { GoogleTtsEngine } from '../../../src/services/tts/engines/google'
import { AzureTtsEngine } from '../../../src/services/tts/engines/azure'
import { ElevenLabsEngine } from '../../../src/services/tts/engines/elevenlabs'
import { StyleBertVits2Engine } from '../../../src/services/tts/engines/style-bert-vits2'
import { OpenAiTtsEngine } from '../../../src/services/tts/engines/openai'
import type { AudioProfile } from '../../../src/services/tts/schema'

describe('createTtsEngine', () => {
  describe('VOICEVOX compatible engines', () => {
    it('creates VoicevoxCompatibleEngine for voicevox', () => {
      const profile: AudioProfile = {
        ttsEngine: 'voicevox',
        url: 'http://localhost:50021',
        speakerId: 1,
      }

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(VoicevoxCompatibleEngine)
      expect(engine.engineType).toBe('voicevox')
    })

    it('creates VoicevoxCompatibleEngine for coeiroink', () => {
      const profile: AudioProfile = {
        ttsEngine: 'coeiroink',
        url: 'http://localhost:50032',
        speakerId: 1,
      }

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(VoicevoxCompatibleEngine)
      expect(engine.engineType).toBe('coeiroink')
    })

    it('creates VoicevoxCompatibleEngine for aivis_speech', () => {
      const profile: AudioProfile = {
        ttsEngine: 'aivis_speech',
        url: 'http://localhost:10101',
        speakerId: 1,
      }

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(VoicevoxCompatibleEngine)
      expect(engine.engineType).toBe('aivis_speech')
    })
  })

  describe('OpenAI TTS', () => {
    it('creates OpenAiTtsEngine', () => {
      const profile: AudioProfile = {
        ttsEngine: 'openai',
        apiKey: 'sk-test-key',
        voice: 'nova',
        model: 'tts-1',
      }

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(OpenAiTtsEngine)
      expect(engine.engineType).toBe('openai')
    })
  })

  describe('Google Cloud TTS', () => {
    it('creates GoogleTtsEngine', () => {
      const profile = {
        ttsEngine: 'google',
        apiKey: 'test-api-key',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-Wavenet-A',
      } as AudioProfile

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(GoogleTtsEngine)
      expect(engine.engineType).toBe('google')
    })
  })

  describe('Azure TTS', () => {
    it('creates AzureTtsEngine', () => {
      const profile: AudioProfile = {
        ttsEngine: 'azure',
        subscriptionKey: 'test-key',
        region: 'japaneast',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-NanamiNeural',
      }

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(AzureTtsEngine)
      expect(engine.engineType).toBe('azure')
    })
  })

  describe('ElevenLabs', () => {
    it('creates ElevenLabsEngine', () => {
      const profile: AudioProfile = {
        ttsEngine: 'elevenlabs',
        apiKey: 'test-key',
        voiceId: 'voice-123',
        modelId: 'eleven_multilingual_v2',
      }

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(ElevenLabsEngine)
      expect(engine.engineType).toBe('elevenlabs')
    })

    it('passes stability and similarityBoost to engine', () => {
      const profile: AudioProfile = {
        ttsEngine: 'elevenlabs',
        apiKey: 'test-key',
        voiceId: 'voice-123',
        modelId: 'eleven_multilingual_v2',
        stability: 0.7,
        similarityBoost: 0.8,
      }

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(ElevenLabsEngine)
    })
  })

  describe('Style-Bert-VITS2', () => {
    it('creates StyleBertVits2Engine', () => {
      const profile: AudioProfile = {
        ttsEngine: 'style_bert_vits2',
        url: 'http://localhost:5000',
        modelName: 'test-model',
        language: 'JP',
      }

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(StyleBertVits2Engine)
      expect(engine.engineType).toBe('style_bert_vits2')
    })

    it('passes style parameters to engine', () => {
      const profile: AudioProfile = {
        ttsEngine: 'style_bert_vits2',
        url: 'http://localhost:5000',
        modelName: 'test-model',
        language: 'JP',
        style: 'Happy',
        styleWeight: 0.8,
      }

      const engine = createTtsEngine(profile)

      expect(engine).toBeInstanceOf(StyleBertVits2Engine)
    })
  })
})
