import { describe, it, expect } from 'vitest'
import { ZodError } from 'zod'
import { generateRequestSchema } from '../../src/api/schema'

describe('generateRequestSchema', () => {
  it('accepts minimal valid payload', () => {
    expect(() =>
      generateRequestSchema.parse({
        characterId: 'anchor-a',
        requests: [{ action: 'speak' }],
      })
    ).not.toThrow()
  })

  it('rejects payloads without requests', () => {
    expect(() => generateRequestSchema.parse({ characterId: 'anchor-a' })).toThrow(ZodError)
  })

  it('rejects payloads without characterId', () => {
    expect(() =>
      generateRequestSchema.parse({
        requests: [{ action: 'idle', params: { durationMs: 500 } }],
      })
    ).toThrow(ZodError)
  })

  it('validates defaults types and reports issues structure', () => {
    try {
      generateRequestSchema.parse({
        characterId: 'anchor-a',
        defaults: { emotion: 123 },
        requests: [{ action: 'idle', params: { durationMs: 1000 } }],
      })
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError)
      expect((error as ZodError).issues).toMatchSnapshot()
    }
  })
})
