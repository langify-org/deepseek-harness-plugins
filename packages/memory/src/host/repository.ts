// The memory directory as a git repository: every change the memory agents make
// is one commit, so a wrong deletion can be undone and the history says why.
import { spawn } from 'node:child_process'
import { access, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

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

  private run(args: readonly string[], input?: string): Promise<string> {
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
      child.on('close', (code) => {
        if (code === 0) resolve(stdout)
        else reject(new Error(`git ${args.join(' ')}: ${stderr.trim() || `exit ${code}`}`))
      })
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
