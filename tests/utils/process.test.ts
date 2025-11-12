import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { runCommand, runCommandWithOutput } from '../../src/utils/process'
import { spawn } from 'node:child_process'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const spawnMock = vi.mocked(spawn)

const createChild = () => {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

describe('process utils', () => {
  beforeEach(() => {
    spawnMock.mockReset()
  })

  it('resolves runCommand when child exits with code 0', async () => {
    const child = createChild()
    spawnMock.mockReturnValue(child as any)
    const promise = runCommand('echo', ['hello'])
    child.emit('exit', 0)
    await expect(promise).resolves.toBeUndefined()
  })

  it('rejects runCommand when child exits with non-zero code', async () => {
    const child = createChild()
    spawnMock.mockReturnValue(child as any)
    const promise = runCommand('echo', ['fail'])
    child.emit('exit', 1)
    await expect(promise).rejects.toThrow('echo fail exited with code 1')
  })

  it('collects stdout and stderr output for runCommandWithOutput', async () => {
    const child = createChild()
    spawnMock.mockReturnValue(child as any)
    const promise = runCommandWithOutput('echo', ['json'])
    child.stdout.emit('data', 'foo')
    child.stdout.emit('data', 'bar')
    child.stderr.emit('data', 'warn')
    child.emit('exit', 0)
    await expect(promise).resolves.toBe('foobar')
  })

  it('includes stderr output on runCommandWithOutput failure', async () => {
    const child = createChild()
    spawnMock.mockReturnValue(child as any)
    const promise = runCommandWithOutput('echo', ['fail'])
    child.stderr.emit('data', 'boom')
    child.emit('exit', 2)
    await expect(promise).rejects.toThrow('boom')
  })
})
