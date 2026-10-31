import { lstatSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

/**
 * Refuse a socket another user could have placed or can reach: the socket and
 * the directory holding it must belong to this user alone, without symlinks.
 * A window opened from a crafted URL then cannot talk to someone else's socket.
 */
export function checkSocket(socketPath: string): void {
  if (!isAbsolute(socketPath)) throw new Error('DSH_CODE_SOCKET must be an absolute path')
  const uid = process.getuid?.()
  const directory = lstatSync(dirname(socketPath))
  if (!directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o077) !== 0) {
    throw new Error('The socket directory must be private to this user')
  }
  const socket = lstatSync(socketPath)
  if (!socket.isSocket() || socket.uid !== uid || (socket.mode & 0o077) !== 0) {
    throw new Error('The socket must be private to this user')
  }
}
