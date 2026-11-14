import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { commitMessage } from '../scribe.ts'
import { Repository } from './repository.ts'

let directory: string | undefined

afterEach(async () => {
  if (directory !== undefined) await rm(directory, { recursive: true, force: true })
  directory = undefined
})

async function repository(): Promise<Repository> {
  directory = join(await mkdtemp(join(tmpdir(), 'dsh-memory-')), 'memory')
  return new Repository('git', directory)
}

function log(dir: string): string {
  return execFileSync('git', ['log', '--format=%an%n%B--'], { cwd: dir, encoding: 'utf8' })
}

describe('Repository', () => {
  it('starts once, and keeps files that are already there', async () => {
    const repo = await repository()
    await repo.init({ 'MEMORY.md': 'first\n' })
    await writeFile(join(repo.directory, 'MEMORY.md'), 'edited\n')
    await repo.commit('Edit\n')
    await repo.init({ 'MEMORY.md': 'first\n' })
    expect(await readFile(join(repo.directory, 'MEMORY.md'), 'utf8')).toBe('edited\n')
    expect(log(repo.directory)).toBe('DSH memory\nEdit\n--\nDSH memory\nStart memory\n--\n')
  })

  it('commits every change with its sources, and nothing when nothing changed', async () => {
    const repo = await repository()
    await repo.init({})
    await writeFile(join(repo.directory, 'note.md'), 'a\n')
    expect(await repo.commit(commitMessage('Add a note', ['s1', 's2', 's1']))).toBe(true)
    expect(await repo.commit(commitMessage('No changes', ['s3']))).toBe(false)
    expect(log(repo.directory)).toBe(
      'DSH memory\nAdd a note\n\nMemory-Source: s1\nMemory-Source: s2\n--\n',
    )
  })

  it('reads files at a version, and the commits between two versions', async () => {
    const repo = await repository()
    await repo.init({ 'MEMORY.md': 'first\n' })
    const start = await repo.head()
    await writeFile(join(repo.directory, 'MEMORY.md'), 'second\n')
    await repo.commit(commitMessage('Change the index', ['s1']))
    const head = await repo.head()
    expect(await repo.show(start, 'MEMORY.md')).toBe('first\n')
    expect(await repo.show(head, 'missing.md')).toBeUndefined()
    expect(await repo.commits(start, head)).toEqual([
      { hash: head, message: 'Change the index', sources: ['s1'] },
    ])
    expect(await repo.commits(head, head)).toEqual([])
    expect(await repo.changed(start, head)).toEqual(['MEMORY.md'])
    expect(await repo.changed(head, head)).toEqual([])
    // A version that is not in the history, as after it was rewritten.
    expect(await repo.commits('0'.repeat(40), head)).toBeUndefined()
  })
})
