import { promises as fs } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VoicevoxClient } from '../../src/services/voicevox'
import { fetch as undiciFetch } from 'undici'

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
  contentType?: string
}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  json: async () => options.json ?? {},
  text: async () => options.text ?? '',
  arrayBuffer: async () => options.buffer ?? new ArrayBuffer(0),
  headers: {
    get: (name: string) => (name.toLowerCase() === 'content-type' ? options.contentType ?? 'audio/wav' : null),
  },
})

describe('VoicevoxClient', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'writeFile').mockResolvedValue()
    fetchMock.mockReset()
  })

  it('rejects empty text inputs', async () => {
    const client = new VoicevoxClient({ endpoint: 'http://localhost:50021' })
    await expect(client.synthesize('   ', '/tmp/out.wav', { speakerId: 1 })).rejects.toThrow('音声合成テキストが空です')
  })

  it('raises descriptive error when audio_query fails', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({ ok: false, status: 500, text: 'engine error', json: { message: 'error' } })
    )
    const client = new VoicevoxClient({ endpoint: 'http://localhost:50021' })

    await expect(client.synthesize('こんにちは', '/tmp/out.wav', { speakerId: 1 })).rejects.toThrow(
      'VOICEVOX audio_query に失敗しました (500): engine error'
    )
  })

  it('raises descriptive error when synthesis fails', async () => {
    fetchMock
      .mockResolvedValueOnce(createResponse({ json: { accent_phrases: [] } }))
      .mockResolvedValueOnce(createResponse({ ok: false, status: 503, text: 'unavailable' }))
    const client = new VoicevoxClient({ endpoint: 'http://localhost:50021' })

    await expect(client.synthesize('test', '/tmp/out.wav', { speakerId: 1 })).rejects.toThrow(
      'VOICEVOX synthesis に失敗しました (503): unavailable'
    )
  })

  it('writes synthesized audio to the provided path on success', async () => {
    fetchMock
      .mockResolvedValueOnce(createResponse({ json: { accent_phrases: [] } }))
      .mockResolvedValueOnce(
        createResponse({
          arrayBuffer: new ArrayBuffer(8),
          contentType: 'audio/wav',
        })
      )
    const client = new VoicevoxClient({ endpoint: 'http://localhost:50021' })

    await client.synthesize('こんにちは', '/tmp/out.wav', { speakerId: 1 })

    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.wav', expect.any(Buffer))
  })

  it('keeps VOICEVOX-provided defaults when overrides are omitted', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createResponse({
          json: {
            accent_phrases: [],
            speedScale: 0.75,
            pitchScale: 0.1,
            intonationScale: 1.2,
            volumeScale: 0.8,
            outputSamplingRate: 44100,
            outputStereo: true,
          },
        })
      )
      .mockResolvedValueOnce(createResponse({ arrayBuffer: new ArrayBuffer(4) }))

    const client = new VoicevoxClient({ endpoint: 'http://localhost:50021' })

    await client.synthesize('テスト', '/tmp/out.wav', { speakerId: 5 })

    const synthesizedPayload = JSON.parse((fetchMock.mock.calls[1]?.[1]?.body as string) ?? '{}')
    expect(synthesizedPayload).toMatchObject({
      speedScale: 0.75,
      pitchScale: 0.1,
      intonationScale: 1.2,
      volumeScale: 0.8,
      outputSamplingRate: 44100,
      outputStereo: true,
    })
  })

  it('applies config-provided synthesis parameters to the audio query', async () => {
    fetchMock
      .mockResolvedValueOnce(
        createResponse({
          json: {
            accent_phrases: [],
            speedScale: 0.5,
            pitchScale: 0.2,
          },
        })
      )
      .mockResolvedValueOnce(createResponse({ arrayBuffer: new ArrayBuffer(4) }))

    const client = new VoicevoxClient({
      endpoint: 'http://localhost:50021',
    })

    await client.synthesize('テスト', '/tmp/out.wav', {
      speakerId: 7,
      speedScale: 1.5,
      pitchScale: -0.3,
      intonationScale: 0.8,
      volumeScale: 0.4,
      outputSamplingRate: 44100,
      outputStereo: true,
    })

    const synthCall = fetchMock.mock.calls[1]
    expect(synthCall[0]).toBe('http://localhost:50021/synthesis?speaker=7')
    const synthesizedPayload = JSON.parse((synthCall[1]?.body as string) ?? '{}')
    expect(synthesizedPayload).toMatchObject({
      speedScale: 1.5,
      pitchScale: -0.3,
      intonationScale: 0.8,
      volumeScale: 0.4,
      outputSamplingRate: 44100,
      outputStereo: true,
    })
  })
})
