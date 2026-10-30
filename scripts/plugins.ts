import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export const root: string = join(import.meta.dirname, '..')

export interface PluginPackage {
  readonly name: string
  readonly dir: string
}

/** Workspace packages that declare a DSH bundle. */
export function pluginPackages(): PluginPackage[] {
  const packagesDir = join(root, 'packages')
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      const dir = join(packagesDir, entry.name)
      const manifest: unknown = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (typeof manifest !== 'object' || manifest === null) return []
      if (!('name' in manifest) || typeof manifest.name !== 'string') return []
      if (!('dsh' in manifest) || typeof manifest.dsh !== 'object' || manifest.dsh === null)
        return []
      return 'bundle' in manifest.dsh ? [{ name: manifest.name, dir }] : []
    })
}
