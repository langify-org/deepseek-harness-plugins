/**
 * Per-session records, so archive hooks still know the `workdir` a start hook
 * chose after DSH restarts. One small JSON file per session.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export interface SessionRecord {
  readonly sessionId: string
  readonly cwd: string | null
  readonly workdir: string | null
  /** ISO timestamp of the start hook run that wrote this record. */
  readonly startedAt: string
}

/** The state directory's name inside the Harness home. */
export const STATE_DIR_NAME = 'langify-session-hooks'

/**
 * `$DSH_HOME/langify-session-hooks`, for hosts that do not provide DSH's own
 * home resolver (`ctx.dshHomePath`).
 */
export function defaultStateDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.DSH_HOME !== undefined && env.DSH_HOME !== '' ? env.DSH_HOME : join(homedir(), '.dsh')
  return join(home, STATE_DIR_NAME)
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export class SessionStateStore {
  readonly dir: string

  constructor(dir: string) {
    this.dir = dir
  }

  /** The record file of one session; rejects ids that could escape the directory. */
  file(sessionId: string): string {
    if (!SAFE_ID.test(sessionId)) throw new Error(`langify-session-hooks: refusing unsafe session id ${JSON.stringify(sessionId)}`)
    return join(this.dir, 'sessions', `${sessionId}.json`)
  }

  async read(sessionId: string): Promise<SessionRecord | undefined> {
    let text: string
    try {
      text = await readFile(this.file(sessionId), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    const value = JSON.parse(text) as Partial<SessionRecord>
    if (value.sessionId !== sessionId) return undefined
    return {
      sessionId,
      cwd: typeof value.cwd === 'string' ? value.cwd : null,
      workdir: typeof value.workdir === 'string' ? value.workdir : null,
      startedAt: typeof value.startedAt === 'string' ? value.startedAt : '',
    }
  }

  async write(record: SessionRecord): Promise<void> {
    const file = this.file(record.sessionId)
    await mkdir(join(this.dir, 'sessions'), { recursive: true })
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
    await rename(temporary, file)
  }
}
