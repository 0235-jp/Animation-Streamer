import { describe, it, expect, vi, beforeEach } from 'vitest'

// APIErrorクラスをvi.hoistedで定義
const { MockAPIError, mocks } = vi.hoisted(() => {
  class APIError extends Error {
    status: number
    constructor(status: number, message: string) {
      super(message)
      this.name = 'APIError'
      this.status = status
    }
  }

  return {
    MockAPIError: APIError,
    mocks: {
      create: vi.fn(),
      streamDestroy: vi.fn(),
      createReadStream: vi.fn(),
      openaiConstructor: vi.fn(),
    },
  }
})

// node:fsをモック
vi.mock('node:fs', () => ({
  default: {
    createReadStream: (...args: unknown[]) => mocks.createReadStream(...args),
  },
  createReadStream: (...args: unknown[]) => mocks.createReadStream(...args),
}))

// OpenAI SDKをモック
vi.mock('openai', () => {
  const OpenAIMock = function (this: unknown, config: unknown) {
    mocks.openaiConstructor(config)
    return {
      audio: {
        transcriptions: {
          create: (...args: unknown[]) => mocks.create(...args),
        },
      },
    }
  } as unknown as typeof import('openai').default
  ;(OpenAIMock as any).APIError = MockAPIError

  return {
    default: OpenAIMock,
    APIError: MockAPIError,
  }
})

import { STTClient } from '../../src/services/stt'

describe('STTClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.create.mockReset()
    mocks.streamDestroy.mockReset()
    mocks.createReadStream.mockReset()
    mocks.openaiConstructor.mockReset()

    // createReadStreamのモックを設定
    mocks.createReadStream.mockReturnValue({
      destroy: mocks.streamDestroy,
    })
  })

  it('creates OpenAI client with correct configuration', () => {
    new STTClient({
      baseUrl: 'http://localhost:8000/v1',
      apiKey: 'test-key',
      model: 'whisper-large',
      language: 'en',
    })

    expect(mocks.openaiConstructor).toHaveBeenCalledWith({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'test-key',
    })
  })

  it('uses dummy-key when apiKey is not provided', () => {
    new STTClient({
      baseUrl: 'http://localhost:8000/v1',
    })

    expect(mocks.openaiConstructor).toHaveBeenCalledWith({
      baseURL: 'http://localhost:8000/v1',
      apiKey: 'dummy-key',
    })
  })

  it('uses default model and language when not provided', async () => {
    const client = new STTClient({
      baseUrl: 'http://localhost:8000/v1',
    })

    mocks.create.mockResolvedValue({ text: 'transcribed text' })

    await client.transcribe('/path/to/audio.wav')

    expect(mocks.create).toHaveBeenCalledWith({
      file: expect.anything(),
      model: 'whisper-1',
      language: 'ja',
    })
  })

  it('transcribes audio file and returns trimmed text', async () => {
    const client = new STTClient({
      baseUrl: 'http://localhost:8000/v1',
      model: 'whisper-large',
      language: 'en',
    })

    mocks.create.mockResolvedValue({ text: '  hello world  ' })

    const result = await client.transcribe('/path/to/audio.wav')

    expect(result).toBe('hello world')
    expect(mocks.createReadStream).toHaveBeenCalledWith('/path/to/audio.wav')
  })

  it('destroys file stream after successful transcription', async () => {
    const client = new STTClient({
      baseUrl: 'http://localhost:8000/v1',
    })

    mocks.create.mockResolvedValue({ text: 'text' })

    await client.transcribe('/path/to/audio.wav')

    expect(mocks.streamDestroy).toHaveBeenCalled()
  })

  it('destroys file stream after failed transcription', async () => {
    const client = new STTClient({
      baseUrl: 'http://localhost:8000/v1',
    })

    mocks.create.mockRejectedValue(new Error('API error'))

    await expect(client.transcribe('/path/to/audio.wav')).rejects.toThrow()

    expect(mocks.streamDestroy).toHaveBeenCalled()
  })

  it('throws error with message for generic errors', async () => {
    const client = new STTClient({
      baseUrl: 'http://localhost:8000/v1',
    })

    mocks.create.mockRejectedValue(new Error('Connection refused'))

    await expect(client.transcribe('/path/to/audio.wav')).rejects.toThrow(
      '音声認識に失敗しました: Connection refused'
    )
  })

  it('throws error with status code for OpenAI APIError', async () => {
    const client = new STTClient({
      baseUrl: 'http://localhost:8000/v1',
    })

    const apiError = new MockAPIError(401, 'Unauthorized')
    mocks.create.mockRejectedValue(apiError)

    await expect(client.transcribe('/path/to/audio.wav')).rejects.toThrow(
      '音声認識に失敗しました: [401] APIError - Unauthorized'
    )
  })
})
