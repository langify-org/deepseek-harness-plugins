import { describe, expect, it } from 'vitest'
import { scrubEnv } from './env.ts'

const env = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/u',
  GH_TOKEN: 'abcdefgh123',
  API_KEY: 'short',
  db_password: 'p@ssw0rd!!',
  AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI',
  DSH_HOME: '/home/u/.dsh',
  UNSET: undefined,
}

describe('scrubEnv', () => {
  it('drops sensitive names and DSH variables', () => {
    expect(scrubEnv(env)).toEqual({ PATH: '/usr/bin:/bin', HOME: '/home/u' })
  })
})
