import { describe, it, expect } from 'vitest'
import {
  googleAudioProfileSchema,
  azureAudioProfileSchema,
  styleBertVits2AudioProfileSchema,
  openAiAudioProfileSchema,
  elevenLabsAudioProfileSchema,
  voicevoxAudioProfileSchema,
} from '../../../src/services/tts/schema'

describe('TTS Schema Validation', () => {
  describe('googleAudioProfileSchema', () => {
    it('requires at least apiKey or credentialsPath', () => {
      const invalidConfig = {
        ttsEngine: 'google',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-Wavenet-A',
      }

      const result = googleAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toContain('apiKey または credentialsPath')
      }
    })

    it('accepts config with apiKey', () => {
      const validConfig = {
        ttsEngine: 'google',
        apiKey: 'test-api-key',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-Wavenet-A',
      }

      const result = googleAudioProfileSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it('accepts config with credentialsPath', () => {
      const validConfig = {
        ttsEngine: 'google',
        credentialsPath: '/path/to/credentials.json',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-Wavenet-A',
      }

      const result = googleAudioProfileSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it('requires languageCode', () => {
      const invalidConfig = {
        ttsEngine: 'google',
        apiKey: 'test-api-key',
        voiceName: 'ja-JP-Wavenet-A',
      }

      const result = googleAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('requires voiceName', () => {
      const invalidConfig = {
        ttsEngine: 'google',
        apiKey: 'test-api-key',
        languageCode: 'ja-JP',
      }

      const result = googleAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })
  })

  describe('azureAudioProfileSchema', () => {
    it('requires languageCode', () => {
      const invalidConfig = {
        ttsEngine: 'azure',
        subscriptionKey: 'test-key',
        region: 'japaneast',
        voiceName: 'ja-JP-NanamiNeural',
      }

      const result = azureAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('accepts valid config with languageCode', () => {
      const validConfig = {
        ttsEngine: 'azure',
        subscriptionKey: 'test-key',
        region: 'japaneast',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-NanamiNeural',
      }

      const result = azureAudioProfileSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it('requires subscriptionKey', () => {
      const invalidConfig = {
        ttsEngine: 'azure',
        region: 'japaneast',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-NanamiNeural',
      }

      const result = azureAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('requires region', () => {
      const invalidConfig = {
        ttsEngine: 'azure',
        subscriptionKey: 'test-key',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-NanamiNeural',
      }

      const result = azureAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })
  })

  describe('styleBertVits2AudioProfileSchema', () => {
    it('requires language', () => {
      const invalidConfig = {
        ttsEngine: 'style_bert_vits2',
        url: 'http://localhost:5000',
        modelName: 'test-model',
      }

      const result = styleBertVits2AudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('accepts valid config with language', () => {
      const validConfig = {
        ttsEngine: 'style_bert_vits2',
        url: 'http://localhost:5000',
        modelName: 'test-model',
        language: 'JP',
      }

      const result = styleBertVits2AudioProfileSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it('accepts optional style and styleWeight', () => {
      const validConfig = {
        ttsEngine: 'style_bert_vits2',
        url: 'http://localhost:5000',
        modelName: 'test-model',
        language: 'JP',
        style: 'Happy',
        styleWeight: 0.8,
      }

      const result = styleBertVits2AudioProfileSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })

    it('validates styleWeight range (0-1)', () => {
      const invalidConfig = {
        ttsEngine: 'style_bert_vits2',
        url: 'http://localhost:5000',
        modelName: 'test-model',
        language: 'JP',
        styleWeight: 1.5, // Out of range
      }

      const result = styleBertVits2AudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })
  })

  describe('openAiAudioProfileSchema', () => {
    it('requires apiKey', () => {
      const invalidConfig = {
        ttsEngine: 'openai',
        voice: 'nova',
        model: 'tts-1',
      }

      const result = openAiAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('requires voice', () => {
      const invalidConfig = {
        ttsEngine: 'openai',
        apiKey: 'sk-test',
        model: 'tts-1',
      }

      const result = openAiAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('requires model', () => {
      const invalidConfig = {
        ttsEngine: 'openai',
        apiKey: 'sk-test',
        voice: 'nova',
      }

      const result = openAiAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('validates voice enum values', () => {
      const invalidConfig = {
        ttsEngine: 'openai',
        apiKey: 'sk-test',
        voice: 'invalid-voice',
        model: 'tts-1',
      }

      const result = openAiAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('validates model enum values', () => {
      const invalidConfig = {
        ttsEngine: 'openai',
        apiKey: 'sk-test',
        voice: 'nova',
        model: 'invalid-model',
      }

      const result = openAiAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('accepts valid config', () => {
      const validConfig = {
        ttsEngine: 'openai',
        apiKey: 'sk-test',
        voice: 'nova',
        model: 'tts-1-hd',
      }

      const result = openAiAudioProfileSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })
  })

  describe('elevenLabsAudioProfileSchema', () => {
    it('requires apiKey', () => {
      const invalidConfig = {
        ttsEngine: 'elevenlabs',
        voiceId: 'voice-123',
        modelId: 'eleven_multilingual_v2',
      }

      const result = elevenLabsAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('requires voiceId', () => {
      const invalidConfig = {
        ttsEngine: 'elevenlabs',
        apiKey: 'test-key',
        modelId: 'eleven_multilingual_v2',
      }

      const result = elevenLabsAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('requires modelId', () => {
      const invalidConfig = {
        ttsEngine: 'elevenlabs',
        apiKey: 'test-key',
        voiceId: 'voice-123',
      }

      const result = elevenLabsAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('validates stability range (0-1)', () => {
      const invalidConfig = {
        ttsEngine: 'elevenlabs',
        apiKey: 'test-key',
        voiceId: 'voice-123',
        modelId: 'eleven_multilingual_v2',
        stability: 1.5, // Out of range
      }

      const result = elevenLabsAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('validates similarityBoost range (0-1)', () => {
      const invalidConfig = {
        ttsEngine: 'elevenlabs',
        apiKey: 'test-key',
        voiceId: 'voice-123',
        modelId: 'eleven_multilingual_v2',
        similarityBoost: -0.1, // Out of range
      }

      const result = elevenLabsAudioProfileSchema.safeParse(invalidConfig)
      expect(result.success).toBe(false)
    })

    it('accepts valid config', () => {
      const validConfig = {
        ttsEngine: 'elevenlabs',
        apiKey: 'test-key',
        voiceId: 'voice-123',
        modelId: 'eleven_multilingual_v2',
        stability: 0.5,
        similarityBoost: 0.75,
      }

      const result = elevenLabsAudioProfileSchema.safeParse(validConfig)
      expect(result.success).toBe(true)
    })
  })

  describe('voicevoxAudioProfileSchema', () => {
    it('transforms voicevoxUrl to url for backward compatibility', () => {
      const config = {
        ttsEngine: 'voicevox',
        voicevoxUrl: 'http://localhost:50021',
        speakerId: 1,
      }

      const result = voicevoxAudioProfileSchema.safeParse(config)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.url).toBe('http://localhost:50021')
        expect('voicevoxUrl' in result.data).toBe(false)
      }
    })

    it('requires either url or voicevoxUrl', () => {
      const invalidConfig = {
        ttsEngine: 'voicevox',
        speakerId: 1,
      }

      // transform内でthrowされるため、safeParseでもエラーがスローされる
      expect(() => voicevoxAudioProfileSchema.safeParse(invalidConfig)).toThrow(
        'voicevox: url または voicevoxUrl が必要です'
      )
    })

    it('accepts url directly', () => {
      const config = {
        ttsEngine: 'voicevox',
        url: 'http://localhost:50021',
        speakerId: 1,
      }

      const result = voicevoxAudioProfileSchema.safeParse(config)
      expect(result.success).toBe(true)
    })
  })
})
