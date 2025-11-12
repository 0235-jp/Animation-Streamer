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
    const client = new VoicevoxClient({ endpoint: 'http://localhost:50021', speakerId: 1 })
    await expect(client.synthesize('   ', '/tmp/out.wav')).rejects.toThrow('音声合成テキストが空です')
  })

  it('raises descriptive error when audio_query fails', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({ ok: false, status: 500, text: 'engine error', json: { message: 'error' } })
    )
    const client = new VoicevoxClient({ endpoint: 'http://localhost:50021', speakerId: 1 })

    await expect(client.synthesize('こんにちは', '/tmp/out.wav')).rejects.toThrow(
      'VOICEVOX audio_query に失敗しました (500): engine error'
    )
  })

  it('raises descriptive error when synthesis fails', async () => {
    fetchMock
      .mockResolvedValueOnce(createResponse({ json: { accent_phrases: [] } }))
      .mockResolvedValueOnce(createResponse({ ok: false, status: 503, text: 'unavailable' }))
    const client = new VoicevoxClient({ endpoint: 'http://localhost:50021', speakerId: 1 })

    await expect(client.synthesize('test', '/tmp/out.wav')).rejects.toThrow(
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
    const client = new VoicevoxClient({ endpoint: 'http://localhost:50021', speakerId: 1 })

    await client.synthesize('こんにちは', '/tmp/out.wav')

    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.wav', expect.any(Buffer))
  })
})
