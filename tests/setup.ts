import { promises as fs } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeAll, beforeEach, vi } from 'vitest'

const projectRoot = path.resolve(process.cwd())
const motionsDir = path.join(projectRoot, 'motions')
const exampleMotionsDir = path.join(projectRoot, 'example/motion')
const outputDir = path.join(projectRoot, 'output')

beforeAll(async () => {
  await fs.mkdir(outputDir, { recursive: true })
  await ensureMotionsDir()
})

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const ensureMotionsDir = async () => {
  try {
    await fs.access(motionsDir)
    return
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code !== 'ENOENT') {
      throw error
    }
  }

  await fs.mkdir(motionsDir, { recursive: true })
  const entries = await fs.readdir(exampleMotionsDir, { withFileTypes: true })
  await Promise.all(
    entries.map(async (entry) => {
      const sourcePath = path.join(exampleMotionsDir, entry.name)
      const targetPath = path.join(motionsDir, entry.name)
      if (entry.isDirectory()) {
        await copyDirectory(sourcePath, targetPath)
      } else if (entry.isFile()) {
        await fs.copyFile(sourcePath, targetPath)
      }
    })
  )
}

const copyDirectory = async (sourceDir: string, targetDir: string) => {
  await fs.mkdir(targetDir, { recursive: true })
  const entries = await fs.readdir(sourceDir, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath)
    } else if (entry.isFile()) {
      await fs.copyFile(sourcePath, targetPath)
    }
  }
}
