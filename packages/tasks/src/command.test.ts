import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { buildCommand, shellQuote } from './command.ts'
import type { Parameter, Recipe } from './rpc.ts'

const param = (name: string, extra: Partial<Parameter> = {}): Parameter => ({
  name,
  kind: 'singular',
  default: null,
  optional: false,
  help: null,
  option: null,
  flag: false,
  ...extra,
})
const recipe = (...parameters: Parameter[]): Recipe => ({ name: 'build', doc: null, parameters })

/** The words bash parses `line` into, with `just` replaced by printf. */
function words(line: string): string[] {
  const out = execFileSync('bash', ['-c', `printf '%s\\0' ${line.replace(/^just /, '')}`])
  return out.toString().split('\0').slice(0, -1)
}

describe('shellQuote', () => {
  it('keeps every value one literal word', () => {
    for (const value of ["it's", 'a b', '$(touch x)', '`id`', '; rm -rf ~', "''", '\\', '*', '']) {
      expect(words(`just ${shellQuote(value)}`)).toEqual([value])
    }
  })
})

describe('buildCommand', () => {
  it('quotes values so the shell passes them through', () => {
    const built = buildCommand(recipe(param('a')), { a: 'x; echo hi' })
    expect(built.ok && words(built.line)).toEqual(['build', 'x; echo hi'])
  })

  it('leaves out trailing optional positionals and requires earlier ones', () => {
    const r = recipe(param('a', { optional: true }), param('b', { optional: true }))
    expect(buildCommand(r, {})).toEqual({ ok: true, line: 'just build' })
    expect(buildCommand(r, { b: 'y' })).toEqual({ ok: false, reason: 'missing', parameter: 'a' })
    expect(buildCommand(recipe(param('a')), {})).toEqual({
      ok: false,
      reason: 'missing',
      parameter: 'a',
    })
  })

  it('passes options, flags, and variadic values', () => {
    const r = recipe(
      param('a'),
      param('mode', { option: '--mode', optional: true }),
      param('verbose', { option: '-v', flag: true, optional: true }),
      param('rest', { kind: 'star', optional: true }),
    )
    const built = buildCommand(r, { a: 'x', mode: 'release', verbose: true, rest: ' p  q ' })
    expect(built.ok && words(built.line)).toEqual([
      'build',
      '--mode',
      'release',
      '-v',
      'x',
      'p',
      'q',
    ])
    expect(buildCommand(recipe(param('mode', { option: '--mode' })), {})).toEqual({
      ok: false,
      reason: 'missing',
      parameter: 'mode',
    })
    // A variadic value needs every positional before it.
    expect(
      buildCommand(recipe(param('a', { optional: true }), param('r', { kind: 'star' })), {
        r: 'p',
      }),
    ).toEqual({ ok: false, reason: 'missing', parameter: 'a' })
    expect(buildCommand(recipe(param('r', { kind: 'plus' })), {})).toEqual({
      ok: false,
      reason: 'missing',
      parameter: 'r',
    })
  })

  it('refuses control characters, which the terminal acts on inside quotes', () => {
    for (const value of ['a\u0003b', 'a\nb', 'a\rb', 'a\u0015', '\u007f']) {
      expect(buildCommand(recipe(param('a')), { a: value })).toEqual({
        ok: false,
        reason: 'control',
        parameter: 'a',
      })
    }
  })
})
