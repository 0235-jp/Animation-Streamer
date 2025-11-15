import { promises as fs } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { loadConfig } from '../../src/config/loader'

describe('loadConfig', () => {
  it('resolves asset paths and normalizes motion metadata', async () => {
    const mkdirSpy = vi.spyOn(fs, 'mkdir')
    const configPath = path.resolve(process.cwd(), 'config/example.stream-profile.local.json')

    const result = await loadConfig(configPath)

    const character = result.characters[0]
    expect(character.actions[0].absolutePath).toBe(path.resolve(process.cwd(), 'example/motion/idle_talk.mp4'))
    expect(character.idleMotions.large[0].emotion).toBe('neutral')
    expect(result.characterMap.get(character.id)).toBe(character)
    expect(result.assets.absoluteTempDir).toBe(path.resolve(process.cwd(), 'config/tmp'))
    expect(mkdirSpy).toHaveBeenCalled()

    mkdirSpy.mockRestore()
  })

  it('throws when schema validation fails', async () => {
    const tempPath = path.resolve(process.cwd(), 'config/invalid.stream-profile.json')
    await fs.writeFile(tempPath, JSON.stringify({ server: { port: 4000 } }), 'utf8')

    try {
      await expect(loadConfig(tempPath)).rejects.toThrow()
    } finally {
      await fs.rm(tempPath, { force: true })
    }
  })
})
