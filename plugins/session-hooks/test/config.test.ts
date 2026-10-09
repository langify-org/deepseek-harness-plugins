import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Config, DEFAULT_TIMEOUT_MS, resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('defaults to no hooks, new sessions only, and bash', () => {
    assert.deepEqual(resolveConfig(undefined), {
      sessionStart: [],
      sessionArchive: [],
      sessionUnarchive: [],
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
    const filled = Config({ sessionStart: ['echo hi'] })
    assert.deepEqual(resolveConfig(filled), resolveConfig({ sessionStart: ['echo hi'] }))
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
})
