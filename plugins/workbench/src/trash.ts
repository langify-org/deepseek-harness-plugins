/**
 * Move a directory to the user's trash, following the freedesktop.org Trash
 * specification: `$XDG_DATA_HOME/Trash/{files,info}`. File managers list it and
 * can restore it.
 */
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'

export function trashDir(env: NodeJS.ProcessEnv = process.env): string {
  const dataHome = env.XDG_DATA_HOME !== undefined && env.XDG_DATA_HOME !== '' ? env.XDG_DATA_HOME : join(homedir(), '.local', 'share')
  return join(dataHome, 'Trash')
}

/**
 * @returns where the directory now is.
 * @throws when the trash is on another filesystem (rename cannot move it).
 */
export async function moveToTrash(path: string, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): Promise<string> {
  const trash = trashDir(env)
  await mkdir(join(trash, 'files'), { recursive: true })
  await mkdir(join(trash, 'info'), { recursive: true })
  const base = basename(path)
  for (let attempt = 0; attempt < 1000; attempt++) {
    const name = attempt === 0 ? base : `${base}.${attempt}`
    const info = join(trash, 'info', `${name}.trashinfo`)
    try {
      // Claiming the info file first reserves the name, as the specification requires.
      await writeFile(info, `[Trash Info]\nPath=${encodeURI(path)}\nDeletionDate=${localTimestamp(now)}\n`, { flag: 'wx' })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
    const target = join(trash, 'files', name)
    try {
      await rename(path, target)
      return target
    } catch (error) {
      await rm(info, { force: true })
      if ((error as NodeJS.ErrnoException).code === 'ENOTEMPTY' || (error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }
  throw new Error(`could not find a free name for ${base} in ${trash}`)
}

function localTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
