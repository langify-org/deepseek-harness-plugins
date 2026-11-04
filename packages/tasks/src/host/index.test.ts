import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseDump } from './index.ts'

// Real `just --dump --dump-format json` output from just 1.51, with `source` replaced.
const dump = readFileSync(new URL('../fixtures/just-1.51-dump.json', import.meta.url), 'utf8')

describe('parseDump', () => {
  it('reads public recipes and their parameters', () => {
    expect(parseDump(dump)).toEqual({
      justfile: '/repo/justfile',
      recipes: [
        {
          name: 'build',
          doc: 'Build it',
          parameters: [
            {
              name: 'target',
              kind: 'singular',
              default: null,
              optional: false,
              help: null,
              option: null,
              flag: false,
            },
            {
              name: 'mode',
              kind: 'singular',
              default: 'debug',
              optional: true,
              help: 'Build mode',
              option: '--mode',
              flag: false,
            },
            {
              name: 'verbose',
              kind: 'singular',
              default: 'false',
              optional: true,
              help: null,
              option: '-v',
              flag: true,
            },
            // An expression default is not prefilled, but makes the parameter optional.
            {
              name: 'home',
              kind: 'singular',
              default: null,
              optional: true,
              help: null,
              option: null,
              flag: false,
            },
            {
              name: 'rest',
              kind: 'star',
              default: null,
              optional: true,
              help: null,
              option: null,
              flag: false,
            },
          ],
        },
      ],
    })
  })

  it('treats a missing justfile as no recipes and rejects other output', () => {
    expect(parseDump(undefined)).toEqual({ justfile: null, recipes: [] })
    expect(() => parseDump('not json')).toThrow('invalid JSON')
    expect(() => parseDump('{"recipes": 1}')).toThrow('recipes')
  })
})
