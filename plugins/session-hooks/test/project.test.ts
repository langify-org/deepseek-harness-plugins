import assert from 'node:assert/strict'
import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { isTrusted, loadProjectHooks, projectRoot } from '../src/project.ts'
import { tempDir } from './helpers.ts'

const settings = (trustedDirs: string[]) => ({ trustedDirs, file: '.dsh/hooks.yml' })

async function project(base: string, name: string, hooks?: string): Promise<string> {
  const root = join(base, name)
  await mkdir(join(root, '.git'), { recursive: true })
  await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  await mkdir(join(root, 'src', 'deep'), { recursive: true })
  if (hooks !== undefined) {
    await mkdir(join(root, '.dsh'), { recursive: true })
    await writeFile(join(root, '.dsh', 'hooks.yml'), hooks)
  }
  return root
}

describe('projectRoot', () => {
  it('climbs to the nearest .git, which a worktree has as a file', async () => {
    const base = await tempDir()
    const root = await project(base, 'repo')
    assert.equal(await projectRoot(join(root, 'src', 'deep')), root)
    const worktree = join(base, 'worktree')
    await mkdir(worktree)
    await writeFile(join(worktree, '.git'), 'gitdir: /elsewhere\n')
    assert.equal(await projectRoot(worktree), worktree)
  })

  it('falls back to the directory itself outside git, ignoring a stray empty .git', async () => {
    const base = await tempDir()
    const plain = join(base, 'plain')
    await mkdir(join(plain, '.git'), { recursive: true })
    assert.equal(await projectRoot(plain), plain)
  })
})

describe('isTrusted', () => {
  it('matches the directory itself and anything below it, through symlinks', async () => {
    const base = await tempDir()
    const trusted = join(base, 'trusted')
    await mkdir(join(trusted, 'repo'), { recursive: true })
    await symlink(trusted, join(base, 'link'))
    assert.equal(await isTrusted(trusted, [trusted]), true)
    assert.equal(await isTrusted(join(trusted, 'repo'), [join(base, 'link')]), true)
    assert.equal(await isTrusted(join(base, 'link', 'repo'), [trusted]), true)
  })

  it('does not match a sibling that shares a prefix, or a missing directory', async () => {
    const base = await tempDir()
    await mkdir(join(base, 'trusted'))
    await mkdir(join(base, 'trusted-not'))
    assert.equal(await isTrusted(join(base, 'trusted-not'), [join(base, 'trusted')]), false)
    assert.equal(await isTrusted(join(base, 'trusted'), [join(base, 'missing')]), false)
  })
})

describe('loadProjectHooks', () => {
  it('reads a trusted project hooks file with inline scripts', async () => {
    const base = await tempDir()
    const root = await project(base, 'repo', ['sessionStart:', '  - |', '    echo one', '    echo two', 'sessionArchive:', '  - ./cleanup.sh', ''].join('\n'))
    const result = await loadProjectHooks(join(root, 'src'), settings([base]))
    assert.equal(result.kind, 'ok')
    assert.ok(result.kind === 'ok')
    assert.equal(result.root, root)
    assert.deepEqual(result.hooks.sessionStart, [{ command: 'echo one\necho two\n' }])
    assert.deepEqual(result.hooks.sessionArchive, [{ command: './cleanup.sh' }])
  })

  it('never reads an untrusted project, and ignores projects without the file', async () => {
    const base = await tempDir()
    const untrusted = await project(base, 'cloned', 'sessionStart: [this is not valid: [')
    assert.deepEqual(await loadProjectHooks(untrusted, settings([join(base, 'elsewhere')])), {
      kind: 'untrusted',
      root: untrusted,
      file: join(untrusted, '.dsh', 'hooks.yml'),
    })
    const bare = await project(base, 'bare')
    assert.deepEqual(await loadProjectHooks(bare, settings([base])), { kind: 'none' })
    assert.deepEqual(await loadProjectHooks(untrusted, settings([])), { kind: 'none' })
  })

  it('reports invalid YAML and invalid hooks', async () => {
    const base = await tempDir()
    const broken = await project(base, 'broken', 'sessionStart: [unclosed')
    const result = await loadProjectHooks(broken, settings([base]))
    assert.equal(result.kind, 'invalid')
    const wrong = await project(base, 'wrong', 'session-start:\n  - echo\n')
    const problem = await loadProjectHooks(wrong, settings([base]))
    assert.ok(problem.kind === 'invalid' && /unknown key "session-start"/.test(problem.problem))
  })
})
