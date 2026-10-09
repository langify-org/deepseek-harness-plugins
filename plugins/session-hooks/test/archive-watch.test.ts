import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'
import { archivedIdsOf, ArchiveWatcher } from '../src/archive-watch.ts'

const globalPut = (archivedSessionIds: unknown): DomainChanged => ({
  domain: 'workspace',
  table: '',
  key: '',
  operation: 'put',
  value: { workspaceIds: [], archivedSessionIds, pinnedSessionIds: [] },
})

describe('archivedIdsOf', () => {
  it('reads the archive set of a workspace global write', () => {
    assert.deepEqual(archivedIdsOf(globalPut(['a', 'b'])), ['a', 'b'])
  })

  it('ignores other domains, tables, deletions, and malformed values', () => {
    assert.equal(archivedIdsOf({ ...globalPut(['a']), domain: 'settings' }), undefined)
    assert.equal(archivedIdsOf({ ...globalPut(['a']), table: 'workspaces', key: 'w1' }), undefined)
    assert.equal(archivedIdsOf({ domain: 'workspace', table: '', key: '', operation: 'deleted' }), undefined)
    assert.equal(archivedIdsOf(globalPut('a')), undefined)
    assert.equal(archivedIdsOf(globalPut([1])), undefined)
  })
})

describe('ArchiveWatcher', () => {
  it('reports additions and removals against the primed baseline', () => {
    const watcher = new ArchiveWatcher(() => ['old'])
    assert.equal(watcher.prime(), true)
    assert.deepEqual(watcher.update(['old', 'new']), { archived: ['new'], unarchived: [] })
    assert.deepEqual(watcher.update(['new']), { archived: [], unarchived: ['old'] })
    assert.deepEqual(watcher.update(['new']), { archived: [], unarchived: [] })
  })

  it('asks the registry at the first change when it could not prime earlier', () => {
    let registry: readonly string[] | undefined
    const watcher = new ArchiveWatcher(() => registry)
    assert.equal(watcher.prime(), false)
    registry = ['old']
    assert.deepEqual(watcher.update(['old', 'new']), { archived: ['new'], unarchived: [] })
  })

  it('adopts the first snapshot silently when the registry never answers', () => {
    const watcher = new ArchiveWatcher(() => {
      throw new Error('workspace registry is not started yet')
    })
    assert.deepEqual(watcher.update(['archived-before-start']), { archived: [], unarchived: [] })
    assert.equal(watcher.primed, true)
    assert.deepEqual(watcher.update(['archived-before-start', 'new']), { archived: ['new'], unarchived: [] })
  })
})
