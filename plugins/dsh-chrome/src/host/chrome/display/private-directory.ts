import { chmod, lstat, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Makes the directory, or takes the one there, private to this user, for a socket that takes
 * no password. It must be this user's own, and so must the directory it is in: whoever owns
 * that could replace the directory, and reach the socket made in it. In a shared directory
 * such as `/tmp`, the directory is therefore one level down, in a directory of the user's.
 * @throws when the directory, or the one it is in, is not this user's own.
 */
export async function makePrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const uid = process.getuid?.();
  if (uid !== undefined) {
    for (const directory of [dirname(path), path]) {
      const status = await lstat(directory);
      if (!status.isDirectory() || status.uid !== uid) {
        throw new Error(`${directory} is not a directory of this user's own`);
      }
    }
  }
  // A directory left from before keeps whatever mode it had; this one must be private.
  await chmod(path, 0o700);
}
