import assert from 'node:assert/strict'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { Config, DEFAULT_TIMEOUT_MS, expandHome, parseHookLists, resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('defaults to no hooks, project hooks off, new sessions only, and bash', () => {
    assert.deepEqual(resolveConfig(undefined), {
      sessionStart: [],
      sessionArchive: [],
      sessionUnarchive: [],
      projectHooks: { trustedDirs: [], file: '.dsh/hooks.yml' },
      startSources: ['startup'],
      includeSubagents: false,
      defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
      shell: 'bash',
    })
  })

  it('accepts bare command strings and command objects', () => {
    const config = resolveConfig({
      sessionStart: ['echo start', { command: 'echo slow', timeoutMs: 5000 }],
      sessionArchive: [{ command: 'echo archive' }],
    })
    assert.deepEqual(config.sessionStart, [{ command: 'echo start' }, { command: 'echo slow', timeoutMs: 5000 }])
    assert.deepEqual(config.sessionArchive, [{ command: 'echo archive' }])
  })

  it('keeps the loader-filled defaults stable', () => {
    const filled = Config({ sessionStart: ['echo hi'], projectHooks: { trustedDirs: ['/srv'] } })
    assert.deepEqual(resolveConfig(filled), resolveConfig({ sessionStart: ['echo hi'], projectHooks: { trustedDirs: ['/srv'] } }))
  })

  it('expands ~ in trusted directories and normalizes the hooks file', () => {
    const config = resolveConfig({ projectHooks: { trustedDirs: ['~/work', '/srv/repos/'], file: './.dsh//hooks.yaml' } })
    assert.deepEqual(config.projectHooks, { trustedDirs: [join(homedir(), 'work'), '/srv/repos/'], file: '.dsh/hooks.yaml' })
  })

  it('deduplicates start sources and rejects unknown ones', () => {
    assert.deepEqual(resolveConfig({ startSources: ['startup', 'resume', 'startup'] }).startSources, ['startup', 'resume'])
    assert.throws(() => resolveConfig({ startSources: ['boot'] }), /unknown start source "boot"/)
  })

  it('rejects malformed values with the plugin prefix', () => {
    assert.throws(() => resolveConfig('nope'), /^Error: langify-session-hooks: config must be a mapping/)
    assert.throws(() => resolveConfig({ sessionStart: 'echo' }), /sessionStart must be a list/)
    assert.throws(() => resolveConfig({ sessionStart: [''] }), /sessionStart\[0\] is an empty command/)
    assert.throws(() => resolveConfig({ sessionArchive: [{ command: 'x', timeoutMs: 0 }] }), /timeoutMs must be a positive integer/)
    assert.throws(() => resolveConfig({ defaultTimeoutMs: 1.5 }), /defaultTimeoutMs must be a positive integer/)
    assert.throws(() => resolveConfig({ shell: ' ' }), /shell must be a non-empty string/)
  })

  it('rejects relative trusted directories and hooks files outside the project', () => {
    assert.throws(() => resolveConfig({ projectHooks: { trustedDirs: ['repos'] } }), /trustedDirs\[0\] must be an absolute path/)
    assert.throws(() => resolveConfig({ projectHooks: { trustedDirs: '/srv' } }), /trustedDirs must be a list/)
    assert.throws(() => resolveConfig({ projectHooks: { file: '../hooks.yml' } }), /file must be a path inside the project/)
    assert.throws(() => resolveConfig({ projectHooks: { file: '/etc/hooks.yml' } }), /file must be a path inside the project/)
  })
})

describe('parseHookLists', () => {
  it('reads the three lists and treats an empty file as no hooks', () => {
    assert.deepEqual(parseHookLists(null, 'hooks.yml'), { sessionStart: [], sessionArchive: [], sessionUnarchive: [] })
    assert.deepEqual(parseHookLists({ sessionArchive: ['echo bye', { command: 'echo slow', timeoutMs: 10 }] }, 'hooks.yml'), {
      sessionStart: [],
      sessionArchive: [{ command: 'echo bye' }, { command: 'echo slow', timeoutMs: 10 }],
      sessionUnarchive: [],
    })
  })

  it('names the file and the field in errors', () => {
    assert.throws(() => parseHookLists(['echo'], '/p/.dsh/hooks.yml'), /^Error: \/p\/\.dsh\/hooks\.yml must be a mapping/)
    assert.throws(() => parseHookLists({ session_start: [] }, 'hooks.yml'), /hooks\.yml: unknown key "session_start"/)
    assert.throws(() => parseHookLists({ sessionStart: [{ run: 'x' }] }, 'hooks.yml'), /hooks\.yml: sessionStart\[0\]\.command must be/)
  })
})

describe('expandHome', () => {
  it('expands only a leading ~', () => {
    assert.equal(expandHome('~', '/home/me'), '/home/me')
    assert.equal(expandHome('~/a/b', '/home/me'), '/home/me/a/b')
    assert.equal(expandHome('/x/~/y', '/home/me'), '/x/~/y')
    assert.equal(expandHome('~other', '/home/me'), '~other')
  })
})
