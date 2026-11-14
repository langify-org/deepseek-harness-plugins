// The memory directory as a git repository: every change the memory agents make
// is one commit, so a wrong deletion can be undone and the history says why.
import { spawn } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LOG_FORMAT, parseCommits, type MemoryCommit } from '../delivery.ts'

/** Commits are the memory agents', not the user's. */
const IDENTITY = ['-c', 'user.name=DSH memory', '-c', 'user.email=memory@dsh.invalid']

export class Repository {
  private readonly git: string
  readonly directory: string

  constructor(git: string, directory: string) {
    this.git = git
    this.directory = directory
  }

  /** Create the directory, its first files and the repository, keeping whatever already exists. */
  async init(files: Readonly<Record<string, string>>): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(this.directory, name), content, { flag: 'wx' }).catch(
        (error: unknown) => {
          if (!isExists(error)) throw error
        },
      )
    }
    if (!(await exists(join(this.directory, '.git')))) await this.run(['init', '-q'])
    await this.commit('Start memory\n')
  }

  /** Commit every change in the directory; false when there was nothing to commit. */
  async commit(message: string): Promise<boolean> {
    await this.run(['add', '-A'])
    if ((await this.run(['status', '--porcelain'])).trim() === '') return false
    await this.run([...IDENTITY, 'commit', '-q', '-F', '-'], message)
    return true
  }

  /** The commit memory is at. */
  async head(): Promise<string> {
    return (await this.run(['rev-parse', 'HEAD'])).trim()
  }

  /** A file as it was at `version`; undefined when it did not exist then. */
  async show(version: string, path: string): Promise<string | undefined> {
    const listed = await this.run(['ls-tree', '--name-only', version, '--', path])
    return listed.trim() === '' ? undefined : this.run(['show', `${version}:${path}`])
  }

  /**
   * The commits after `from` up to `to`, oldest first; undefined when `from` is
   * not in `to`'s history, as after the history was rewritten.
   */
  async commits(from: string, to: string): Promise<MemoryCommit[] | undefined> {
    // An object git does not have at all is answered 1; merge-base would fail on it.
    if (!(await this.succeeds(['cat-file', '-e', from]))) return undefined
    if (!(await this.succeeds(['merge-base', '--is-ancestor', from, to]))) return undefined
    return parseCommits(
      await this.run(['log', '--reverse', `--format=${LOG_FORMAT}`, `${from}..${to}`]),
    )
  }

  /** Run git for its output, failing unless it succeeds. */
  private async run(args: readonly string[], input?: string): Promise<string> {
    const { code, stdout, stderr } = await this.spawn(args, input)
    if (code !== 0) throw new Error(`git ${args.join(' ')}: ${stderr.trim() || `exit ${code}`}`)
    return stdout
  }

  /** Run git for its answer: whether it exited 0, or 1. Anything else is a failure. */
  private async succeeds(args: readonly string[]): Promise<boolean> {
    const { code, stderr } = await this.spawn(args)
    if (code === 0 || code === 1) return code === 0
    throw new Error(`git ${args.join(' ')}: ${stderr.trim() || `exit ${code}`}`)
  }

  private spawn(
    args: readonly string[],
    input?: string,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.git, args, {
        cwd: this.directory,
        stdio: 'pipe',
      })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, stdout, stderr }))
      // A git that exits before reading reports why on close; the broken pipe adds nothing.
      child.stdin.on('error', () => {}).end(input ?? '')
    })
  }
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}

function isExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}
