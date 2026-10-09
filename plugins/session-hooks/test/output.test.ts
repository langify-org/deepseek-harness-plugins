import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { parseStartOutput } from '../src/output.ts'

describe('parseStartOutput', () => {
  it('ignores empty and plain-text output', () => {
    assert.deepEqual(parseStartOutput(''), {})
    assert.deepEqual(parseStartOutput('Preparing worktree...\nHEAD is now at abc123\n'), {})
  })

  it('reads a whole-stdout JSON object', () => {
    const stdout = JSON.stringify({ workdir: '/tmp/wt', context: 'Use branch feature/x.' }, null, 2)
    assert.deepEqual(parseStartOutput(stdout), { output: { workdir: '/tmp/wt', context: 'Use branch feature/x.' } })
  })

  it('reads the last line after log output', () => {
    const stdout = 'Preparing worktree (new branch)\n{"workdir":"/tmp/wt"}\n'
    assert.deepEqual(parseStartOutput(stdout), { output: { workdir: '/tmp/wt' } })
  })

  it('reports invalid JSON and wrong field types', () => {
    assert.match(parseStartOutput('{"workdir": }').problem ?? '', /invalid JSON/)
    assert.deepEqual(parseStartOutput('{"workdir": 3, "context": "ok"}'), {
      output: { context: 'ok' },
      problem: '"workdir" must be a non-empty string',
    })
  })

  it('drops blank context and ignores unknown fields', () => {
    assert.deepEqual(parseStartOutput('{"context": "  ", "other": 1}'), { output: {} })
  })
})
