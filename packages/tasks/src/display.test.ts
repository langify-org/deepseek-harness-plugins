import { describe, expect, it } from 'vitest'
import { justfileLabel, parameterLabel } from './display.ts'
import type { Parameter } from './rpc.ts'

const param = (extra: Partial<Parameter>): Parameter => ({
  name: 'x',
  kind: 'singular',
  default: null,
  optional: false,
  help: null,
  option: null,
  flag: false,
  ...extra,
})

describe('parameterLabel', () => {
  it("writes parameters in just's notation", () => {
    expect(parameterLabel(param({}))).toBe('x')
    expect(parameterLabel(param({ default: 'debug', optional: true }))).toBe('x=debug')
    expect(parameterLabel(param({ optional: true }))).toBe('[x]')
    expect(parameterLabel(param({ option: '--verbose', flag: true, optional: true }))).toBe(
      '[--verbose]',
    )
    expect(parameterLabel(param({ option: '--mode', default: 'a', optional: true }))).toBe(
      '--mode=a',
    )
    expect(parameterLabel(param({ kind: 'star', optional: true }))).toBe('*x')
    expect(parameterLabel(param({ kind: 'plus' }))).toBe('+x')
  })
})

describe('justfileLabel', () => {
  it('names a justfile above the folder relatively, and none in it', () => {
    expect(justfileLabel('/repo', '/repo/justfile')).toBeUndefined()
    expect(justfileLabel('/repo/a/b', '/repo/justfile')).toBe('../../justfile')
    expect(justfileLabel('/repo/a', '/repo/Justfile')).toBe('../Justfile')
    expect(justfileLabel('/srv', '/justfile')).toBe('../justfile')
    // Not above the folder, as through a symlink: the full path.
    expect(justfileLabel('/link/repo', '/real/repo/justfile')).toBe('/real/repo/justfile')
    expect(justfileLabel('/repo-x', '/repo/justfile')).toBe('/repo/justfile')
  })
})
