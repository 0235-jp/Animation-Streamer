import { promises as fs } from 'node:fs'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StyleBertVits2Client } from '../../src/services/style-bert-vits2'
import { fetch as undiciFetch } from 'undici'

vi.mock('undici', () => ({
  fetch: vi.fn(),
}))

const fetchMock = vi.mocked(undiciFetch)

const createResponse = (options: {
  ok?: boolean
  status?: number
  text?: string
  buffer?: ArrayBuffer
  contentType?: string
}) => ({
  ok: options.ok ?? true,
  status: options.status ?? 200,
  text: async () => options.text ?? '',
  arrayBuffer: async () => options.buffer ?? new ArrayBuffer(0),
  headers: {
    get: (name: string) => (name.toLowerCase() === 'content-type' ? options.contentType ?? 'audio/wav' : null),
  },
})

describe('StyleBertVits2Client', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'writeFile').mockResolvedValue()
    fetchMock.mockReset()
  })

  it('rejects empty text inputs', async () => {
    const client = new StyleBertVits2Client({ endpoint: 'http://localhost:5000' })
    await expect(client.synthesize('   ', '/tmp/out.wav', {})).rejects.toThrow('音声合成テキストが空です')
  })

  it('raises descriptive error when synthesis fails', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({ ok: false, status: 500, text: 'engine error' })
    )
    const client = new StyleBertVits2Client({ endpoint: 'http://localhost:5000' })

    await expect(client.synthesize('こんにちは', '/tmp/out.wav', {})).rejects.toThrow(
      'Style-Bert-VITS2 音声合成に失敗しました (500): engine error'
    )
  })

  it('writes synthesized audio to the provided path on success', async () => {
    fetchMock.mockResolvedValueOnce(
      createResponse({
        arrayBuffer: new ArrayBuffer(8),
        contentType: 'audio/wav',
      })
    )
    const client = new StyleBertVits2Client({ endpoint: 'http://localhost:5000' })

    await client.synthesize('こんにちは', '/tmp/out.wav', {})

    expect(fs.writeFile).toHaveBeenCalledWith('/tmp/out.wav', expect.any(Buffer))
  })

  it('includes model_id and speaker_id in query params when specified', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ arrayBuffer: new ArrayBuffer(4) }))
    const client = new StyleBertVits2Client({ endpoint: 'http://localhost:5000' })

    await client.synthesize('テスト', '/tmp/out.wav', { modelId: 0, speakerId: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('model_id=0')
    expect(url).toContain('speaker_id=1')
  })

  it('includes model_name and speaker_name in query params when specified', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ arrayBuffer: new ArrayBuffer(4) }))
    const client = new StyleBertVits2Client({ endpoint: 'http://localhost:5000' })

    await client.synthesize('テスト', '/tmp/out.wav', { modelName: 'test-model', speakerName: 'speaker-a' })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('model_name=test-model')
    expect(url).toContain('speaker_name=speaker-a')
  })

  it('includes synthesis parameters in query', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ arrayBuffer: new ArrayBuffer(4) }))
    const client = new StyleBertVits2Client({ endpoint: 'http://localhost:5000' })

    await client.synthesize('テスト', '/tmp/out.wav', {
      sdpRatio: 0.5,
      noise: 0.6,
      noisew: 0.7,
      length: 1.2,
      language: 'JP',
    })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('sdp_ratio=0.5')
    expect(url).toContain('noise=0.6')
    expect(url).toContain('noisew=0.7')
    expect(url).toContain('length=1.2')
    expect(url).toContain('language=JP')
  })

  it('includes style parameters in query', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ arrayBuffer: new ArrayBuffer(4) }))
    const client = new StyleBertVits2Client({ endpoint: 'http://localhost:5000' })

    await client.synthesize('テスト', '/tmp/out.wav', {
      style: 'happy',
      styleWeight: 1.5,
      assistText: '嬉しい',
      assistTextWeight: 0.8,
    })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('style=happy')
    expect(url).toContain('style_weight=1.5')
    expect(url).toContain(encodeURIComponent('嬉しい'))
    expect(url).toContain('assist_text_weight=0.8')
  })

  it('includes auto_split and split_interval in query', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ arrayBuffer: new ArrayBuffer(4) }))
    const client = new StyleBertVits2Client({ endpoint: 'http://localhost:5000' })

    await client.synthesize('テスト', '/tmp/out.wav', {
      autoSplit: true,
      splitInterval: 0.5,
    })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('auto_split=true')
    expect(url).toContain('split_interval=0.5')
  })

  it('uses override endpoint when provided', async () => {
    fetchMock.mockResolvedValueOnce(createResponse({ arrayBuffer: new ArrayBuffer(4) }))
    const client = new StyleBertVits2Client({ endpoint: 'http://localhost:5000' })

    await client.synthesize('テスト', '/tmp/out.wav', {}, { endpoint: 'http://other:6000' })

    const url = fetchMock.mock.calls[0][0] as string
    expect(url).toContain('http://other:6000/voice')
  })

  it('throws error when endpoint is not configured', async () => {
    const client = new StyleBertVits2Client()
    await expect(client.synthesize('テスト', '/tmp/out.wav', {})).rejects.toThrow(
      'Style-Bert-VITS2 endpoint が設定されていません'
    )
  })
})
