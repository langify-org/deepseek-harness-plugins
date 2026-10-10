/** `workbenches.json`: every workbench this plugin made, keyed by Workspace id. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Workbench } from './protocol.ts'

export class WorkbenchStore {
  readonly file: string

  constructor(file: string) {
    this.file = file
  }

  async all(): Promise<Workbench[]> {
    let text: string
    try {
      text = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
    const value = JSON.parse(text) as { workbenches?: unknown }
    return Array.isArray(value.workbenches) ? (value.workbenches as Workbench[]) : []
  }

  async put(workbench: Workbench): Promise<void> {
    const all = (await this.all()).filter((entry) => entry.workspaceId !== workbench.workspaceId)
    await this.save([...all, workbench])
  }

  async delete(workspaceId: string): Promise<void> {
    await this.save((await this.all()).filter((entry) => entry.workspaceId !== workspaceId))
  }

  private async save(workbenches: readonly Workbench[]): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const temporary = `${this.file}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify({ version: 1, workbenches }, null, 2)}\n`, 'utf8')
    await rename(temporary, this.file)
  }
}
