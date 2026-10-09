/**
 * Archive detection.
 *
 * DSH has no "session archived" event. The workspace registry keeps the archive
 * set in its storage domain's global record, and every durable write of that
 * record emits `domain/changed` with the new snapshot. Diffing consecutive
 * snapshots yields the sessions that were archived or restored.
 */
import type { DomainChanged } from '@deepseek-ai/dsh-storage-domain'

/** The archive set carried by a workspace global-record write, or `undefined` for any other change. */
export function archivedIdsOf(change: DomainChanged): readonly string[] | undefined {
  if (change.domain !== 'workspace' || change.table !== '' || change.operation !== 'put') return undefined
  const value = change.value
  if (typeof value !== 'object' || value === null) return undefined
  const ids = (value as { archivedSessionIds?: unknown }).archivedSessionIds
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) return undefined
  return ids as string[]
}

export interface ArchiveDelta {
  readonly archived: readonly string[]
  readonly unarchived: readonly string[]
}

const NONE: ArchiveDelta = { archived: [], unarchived: [] }

export class ArchiveWatcher {
  private known: Set<string> | undefined
  private readonly current: () => readonly string[] | undefined

  /**
   * @param current - reads the archive set the registry holds right now; may
   *   return `undefined` or throw while the registry is not started.
   */
  constructor(current: () => readonly string[] | undefined) {
    this.current = current
  }

  /** Whether a baseline is known. */
  get primed(): boolean {
    return this.known !== undefined
  }

  /** Take the baseline from the registry if none is known yet. */
  prime(): boolean {
    if (this.known !== undefined) return true
    let ids: readonly string[] | undefined
    try {
      ids = this.current()
    } catch {
      ids = undefined
    }
    if (ids === undefined) return false
    this.known = new Set(ids)
    return true
  }

  /**
   * Apply a new durable snapshot.
   *
   * Without a baseline, the registry is asked first: it still holds the
   * previous set while it announces the write. If it cannot answer, the
   * snapshot becomes the baseline and nothing is reported, so sessions archived
   * before the plugin started never fire hooks.
   */
  update(next: readonly string[]): ArchiveDelta {
    if (!this.prime()) {
      this.known = new Set(next)
      return NONE
    }
    const known = this.known!
    const nextSet = new Set(next)
    const archived = next.filter((id) => !known.has(id))
    const unarchived = [...known].filter((id) => !nextSet.has(id))
    this.known = nextSet
    return archived.length === 0 && unarchived.length === 0 ? NONE : { archived, unarchived }
  }
}
