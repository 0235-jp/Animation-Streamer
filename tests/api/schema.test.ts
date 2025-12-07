import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { generateRequestSchema, audioInputSchema, speakParamsSchema } from '../../src/api/schema'

describe('generateRequestSchema', () => {
  it('accepts minimal valid payload', () => {
    expect(() =>
      generateRequestSchema.parse({
        presetId: 'anchor-a',
        requests: [{ action: 'speak' }],
      })
    ).not.toThrow()
  })

  it('rejects payloads without requests', () => {
    expect(() => generateRequestSchema.parse({ presetId: 'anchor-a' })).toThrow(ZodError)
  })

  it('rejects payloads without presetId', () => {
    expect(() =>
      generateRequestSchema.parse({
        requests: [{ action: 'idle', params: { durationMs: 500 } }],
      })
    ).toThrow(ZodError)
  })

  it('validates defaults types and reports issues structure', () => {
    try {
      generateRequestSchema.parse({
        presetId: 'anchor-a',
        defaults: { emotion: 123 },
        requests: [{ action: 'idle', params: { durationMs: 1000 } }],
      })
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      expect((error as ZodError).issues).toMatchSnapshot()
    }
  })
})

describe('audioInputSchema', () => {
  it('accepts valid path input', () => {
    expect(() =>
      audioInputSchema.parse({ path: '/path/to/audio.wav' })
    ).not.toThrow()
  })

  it('accepts valid base64 input', () => {
    expect(() =>
      audioInputSchema.parse({ base64: 'UklGR...' })
    ).not.toThrow()
  })

  it('accepts path with transcribe option', () => {
    expect(() =>
      audioInputSchema.parse({ path: '/path/to/audio.wav', transcribe: true })
    ).not.toThrow()
  })

  it('rejects when both path and base64 are provided', () => {
    expect(() =>
      audioInputSchema.parse({ path: '/path/to/audio.wav', base64: 'UklGR...' })
    ).toThrow(ZodError)
  })

  it('rejects when neither path nor base64 is provided', () => {
    expect(() =>
      audioInputSchema.parse({})
    ).toThrow(ZodError)
  })

  it('rejects when only transcribe is provided', () => {
    expect(() =>
      audioInputSchema.parse({ transcribe: true })
    ).toThrow(ZodError)
  })

  it('rejects empty string path', () => {
    expect(() =>
      audioInputSchema.parse({ path: '' })
    ).toThrow(ZodError)
  })

  it('rejects empty string base64', () => {
    expect(() =>
      audioInputSchema.parse({ base64: '' })
    ).toThrow(ZodError)
  })
})

describe('speakParamsSchema', () => {
  it('accepts valid text input', () => {
    expect(() =>
      speakParamsSchema.parse({ text: 'こんにちは' })
    ).not.toThrow()
  })

  it('accepts valid audio input', () => {
    expect(() =>
      speakParamsSchema.parse({ audio: { path: '/path/to/audio.wav' } })
    ).not.toThrow()
  })

  it('accepts text with emotion', () => {
    expect(() =>
      speakParamsSchema.parse({ text: 'こんにちは', emotion: 'happy' })
    ).not.toThrow()
  })

  it('accepts audio with emotion', () => {
    expect(() =>
      speakParamsSchema.parse({
        audio: { path: '/path/to/audio.wav', transcribe: true },
        emotion: 'happy',
      })
    ).not.toThrow()
  })

  it('rejects when both text and audio are provided', () => {
    expect(() =>
      speakParamsSchema.parse({
        text: 'こんにちは',
        audio: { path: '/path/to/audio.wav' },
      })
    ).toThrow(ZodError)
  })

  it('rejects when neither text nor audio is provided', () => {
    expect(() =>
      speakParamsSchema.parse({})
    ).toThrow(ZodError)
  })

  it('rejects when only emotion is provided', () => {
    expect(() =>
      speakParamsSchema.parse({ emotion: 'happy' })
    ).toThrow(ZodError)
  })

  it('rejects whitespace-only text', () => {
    expect(() =>
      speakParamsSchema.parse({ text: '   ' })
    ).toThrow(ZodError)
  })

  it('rejects empty string text', () => {
    expect(() =>
      speakParamsSchema.parse({ text: '' })
    ).toThrow(ZodError)
  })
})
