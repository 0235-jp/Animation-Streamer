import { promises as fs } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetch as undiciFetch } from 'undici'
import { GoogleTtsEngine } from '../../../src/services/tts/engines/google'
import { AzureTtsEngine } from '../../../src/services/tts/engines/azure'
import { ElevenLabsEngine } from '../../../src/services/tts/engines/elevenlabs'
import { StyleBertVits2Engine } from '../../../src/services/tts/engines/style-bert-vits2'
import { OpenAiTtsEngine } from '../../../src/services/tts/engines/openai'

vi.mock('undici', () => ({
  fetch: vi.fn(),
}))

const fetchMock = vi.mocked(undiciFetch)

const createResponse = (options: {
  ok?: boolean
  status?: number
  json?: unknown
  text?: string
  buffer?: ArrayBuffer
}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  json: async () => options.json ?? {},
  text: async () => options.text ?? '',
  arrayBuffer: async () => options.buffer ?? new ArrayBuffer(8),
})

describe('GoogleTtsEngine', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'writeFile').mockResolvedValue()
    fetchMock.mockReset()
  })

  it('sends API key in x-goog-api-key header', async () => {
    const audioContent = Buffer.from('audio data').toString('base64')
    fetchMock.mockResolvedValueOnce(createResponse({ json: { audioContent } }))

    const engine = new GoogleTtsEngine({
      apiKey: 'test-api-key',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-Wavenet-A',
    })

    await engine.synthesize('テスト', '/tmp/out.wav', {
      emotion: 'neutral',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-Wavenet-A',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-goog-api-key': 'test-api-key',
        }),
      })
    )
  })

  it('throws error when API key is not set', async () => {
    const engine = new GoogleTtsEngine({
      apiKey: undefined,
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-Wavenet-A',
    })

    await expect(
      engine.synthesize('テスト', '/tmp/out.wav', {
        emotion: 'neutral',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-Wavenet-A',
      })
    ).rejects.toThrow('Google TTS: APIキーが設定されていません')
  })

  it('throws error when audioContent is empty', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ json: {} }))

    const engine = new GoogleTtsEngine({
      apiKey: 'test-api-key',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-Wavenet-A',
    })

    await expect(
      engine.synthesize('テスト', '/tmp/out.wav', {
        emotion: 'neutral',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-Wavenet-A',
      })
    ).rejects.toThrow('Google TTS: audioContentが空です')
  })

  it('clamps volumeGainDb to valid range', async () => {
    const audioContent = Buffer.from('audio data').toString('base64')
    fetchMock.mockResolvedValueOnce(createResponse({ json: { audioContent } }))

    const engine = new GoogleTtsEngine({
      apiKey: 'test-api-key',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-Wavenet-A',
    })

    await engine.synthesize('テスト', '/tmp/out.wav', {
      emotion: 'neutral',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-Wavenet-A',
      volumeScale: 100, // Very high value that would exceed 16dB
    })

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(requestBody.audioConfig.volumeGainDb).toBe(16) // Clamped to max
  })

  it('rejects empty text', async () => {
    const engine = new GoogleTtsEngine({
      apiKey: 'test-api-key',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-Wavenet-A',
    })

    await expect(
      engine.synthesize('   ', '/tmp/out.wav', {
        emotion: 'neutral',
        languageCode: 'ja-JP',
        voiceName: 'ja-JP-Wavenet-A',
      })
    ).rejects.toThrow('音声合成テキストが空です')
  })
})

describe('AzureTtsEngine', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'writeFile').mockResolvedValue()
    fetchMock.mockReset()
  })

  it('uses languageCode in SSML xml:lang attribute', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new AzureTtsEngine({
      subscriptionKey: 'test-key',
      region: 'japaneast',
      languageCode: 'en-US',
      voiceName: 'en-US-JennyNeural',
    })

    await engine.synthesize('Hello', '/tmp/out.wav', {
      emotion: 'neutral',
      voiceName: 'en-US-JennyNeural',
    })

    const ssmlBody = fetchMock.mock.calls[0]?.[1]?.body as string
    expect(ssmlBody).toContain('xml:lang="en-US"')
  })

  it('overrides languageCode from voice profile', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new AzureTtsEngine({
      subscriptionKey: 'test-key',
      region: 'japaneast',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-NanamiNeural',
    })

    await engine.synthesize('Hello', '/tmp/out.wav', {
      emotion: 'neutral',
      voiceName: 'en-US-JennyNeural',
      languageCode: 'en-US', // Override
    })

    const ssmlBody = fetchMock.mock.calls[0]?.[1]?.body as string
    expect(ssmlBody).toContain('xml:lang="en-US"')
  })

  it('sends subscription key in header', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new AzureTtsEngine({
      subscriptionKey: 'my-subscription-key',
      region: 'japaneast',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-NanamiNeural',
    })

    await engine.synthesize('テスト', '/tmp/out.wav', {
      emotion: 'neutral',
      voiceName: 'ja-JP-NanamiNeural',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'Ocp-Apim-Subscription-Key': 'my-subscription-key',
        }),
      })
    )
  })

  it('includes style in SSML when provided', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new AzureTtsEngine({
      subscriptionKey: 'test-key',
      region: 'japaneast',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-NanamiNeural',
    })

    await engine.synthesize('テスト', '/tmp/out.wav', {
      emotion: 'neutral',
      voiceName: 'ja-JP-NanamiNeural',
      style: 'cheerful',
      styleDegree: 1.5,
    })

    const ssmlBody = fetchMock.mock.calls[0]?.[1]?.body as string
    expect(ssmlBody).toContain('mstts:express-as style="cheerful"')
    expect(ssmlBody).toContain('styledegree="1.5"')
  })

  it('escapes XML special characters in text', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new AzureTtsEngine({
      subscriptionKey: 'test-key',
      region: 'japaneast',
      languageCode: 'ja-JP',
      voiceName: 'ja-JP-NanamiNeural',
    })

    await engine.synthesize('<script>alert("xss")</script>', '/tmp/out.wav', {
      emotion: 'neutral',
      voiceName: 'ja-JP-NanamiNeural',
    })

    const ssmlBody = fetchMock.mock.calls[0]?.[1]?.body as string
    expect(ssmlBody).toContain('&lt;script&gt;')
    expect(ssmlBody).toContain('&quot;xss&quot;')
    expect(ssmlBody).not.toContain('<script>')
  })
})

describe('ElevenLabsEngine', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'writeFile').mockResolvedValue()
    fetchMock.mockReset()
  })

  it('sends API key in xi-api-key header', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new ElevenLabsEngine({
      apiKey: 'eleven-api-key',
      voiceId: 'voice-123',
      modelId: 'eleven_multilingual_v2',
    })

    await engine.synthesize('テスト', '/tmp/out.wav', {
      emotion: 'neutral',
      voiceId: 'voice-123',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('voice-123'),
      expect.objectContaining({
        headers: expect.objectContaining({
          'xi-api-key': 'eleven-api-key',
        }),
      })
    )
  })

  it('includes model_id and voice settings in request body', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new ElevenLabsEngine({
      apiKey: 'eleven-api-key',
      voiceId: 'voice-123',
      modelId: 'eleven_multilingual_v2',
      stability: 0.7,
      similarityBoost: 0.8,
    })

    await engine.synthesize('テスト', '/tmp/out.wav', {
      emotion: 'neutral',
      voiceId: 'voice-123',
    })

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(requestBody.model_id).toBe('eleven_multilingual_v2')
    expect(requestBody.voice_settings.stability).toBe(0.7)
    expect(requestBody.voice_settings.similarity_boost).toBe(0.8)
  })

  it('raises error on API failure', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ ok: false, status: 401, text: 'Unauthorized' }))

    const engine = new ElevenLabsEngine({
      apiKey: 'invalid-key',
      voiceId: 'voice-123',
      modelId: 'eleven_multilingual_v2',
    })

    await expect(
      engine.synthesize('テスト', '/tmp/out.wav', {
        emotion: 'neutral',
        voiceId: 'voice-123',
      })
    ).rejects.toThrow('ElevenLabs TTS に失敗しました (401)')
  })
})

describe('StyleBertVits2Engine', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'writeFile').mockResolvedValue()
    fetchMock.mockReset()
  })

  it('uses configured language in request', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new StyleBertVits2Engine({
      url: 'http://localhost:5000',
      modelName: 'test-model',
      language: 'EN',
    })

    await engine.synthesize('Hello', '/tmp/out.wav', {
      emotion: 'neutral',
      modelName: 'test-model',
    })

    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain('language=EN')
  })

  it('overrides language from voice profile', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new StyleBertVits2Engine({
      url: 'http://localhost:5000',
      modelName: 'test-model',
      language: 'JP',
    })

    await engine.synthesize('Hello', '/tmp/out.wav', {
      emotion: 'neutral',
      modelName: 'test-model',
      language: 'ZH', // Override
    })

    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain('language=ZH')
  })

  it('includes style parameters when provided', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new StyleBertVits2Engine({
      url: 'http://localhost:5000',
      modelName: 'test-model',
      language: 'JP',
      style: 'Happy',
      styleWeight: 0.8,
    })

    await engine.synthesize('テスト', '/tmp/out.wav', {
      emotion: 'neutral',
      modelName: 'test-model',
    })

    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toContain('style=Happy')
    expect(url).toContain('style_weight=0.8')
  })

  it('strips trailing slashes from endpoint URL', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new StyleBertVits2Engine({
      url: 'http://localhost:5000///',
      modelName: 'test-model',
      language: 'JP',
    })

    await engine.synthesize('テスト', '/tmp/out.wav', {
      emotion: 'neutral',
      modelName: 'test-model',
    })

    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toMatch(/^http:\/\/localhost:5000\/voice\?/)
  })
})

describe('OpenAiTtsEngine', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'writeFile').mockResolvedValue()
    fetchMock.mockReset()
  })

  it('sends API key in Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new OpenAiTtsEngine({
      apiKey: 'sk-test-key',
      voice: 'nova',
      model: 'tts-1',
    })

    await engine.synthesize('Hello', '/tmp/out.wav', {
      emotion: 'neutral',
      voice: 'nova',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test-key',
        }),
      })
    )
  })

  it('uses configured voice and model', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new OpenAiTtsEngine({
      apiKey: 'sk-test-key',
      voice: 'shimmer',
      model: 'tts-1-hd',
    })

    await engine.synthesize('Hello', '/tmp/out.wav', {
      emotion: 'neutral',
      voice: 'shimmer',
    })

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(requestBody.voice).toBe('shimmer')
    expect(requestBody.model).toBe('tts-1-hd')
  })

  it('overrides voice from voice profile', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new OpenAiTtsEngine({
      apiKey: 'sk-test-key',
      voice: 'nova',
      model: 'tts-1',
    })

    await engine.synthesize('Hello', '/tmp/out.wav', {
      emotion: 'neutral',
      voice: 'alloy', // Override
    })

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(requestBody.voice).toBe('alloy')
  })

  it('applies speed parameter', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ buffer: new ArrayBuffer(8) }))

    const engine = new OpenAiTtsEngine({
      apiKey: 'sk-test-key',
      voice: 'nova',
      model: 'tts-1',
    })

    await engine.synthesize('Hello', '/tmp/out.wav', {
      emotion: 'neutral',
      voice: 'nova',
      speedScale: 1.5,
    })

    const requestBody = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)
    expect(requestBody.speed).toBe(1.5)
  })
})
