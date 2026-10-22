import { randomBytes } from 'node:crypto';
import { chmod, writeFile } from 'node:fs/promises';

/** X's shared-secret authorization: a client shows the server the cookie both were given. */
export const X_COOKIE_NAME = 'MIT-MAGIC-COOKIE-1';
/** An entry's family that matches every address, as for a display only this machine uses. */
const FAMILY_WILD = 0xffff;
const COOKIE_BYTES = 16;

/**
 * Writes an X authority file holding a new random cookie, readable by this user only. The X
 * server given it (`-auth`) then admits only the programs given it too (\`XAUTHORITY\`):
 * without one, Xvnc admits any local connection, whichever user makes it, and that would
 * reach Chrome's screen and input around the VNC socket's private directory.
 *
 * The entry holds no address and no display number, so it serves whichever display number
 * the server takes.
 */
export async function writeXAuthority(path: string): Promise<void> {
  const family = Buffer.alloc(2);
  family.writeUInt16BE(FAMILY_WILD);
  const entry = Buffer.concat([
    family,
    counted(Buffer.alloc(0)),
    counted(Buffer.alloc(0)),
    counted(Buffer.from(X_COOKIE_NAME, 'latin1')),
    counted(randomBytes(COOKIE_BYTES)),
  ]);
  await writeFile(path, entry, { mode: 0o600 });
  // A file left from before keeps whatever mode it had.
  await chmod(path, 0o600);
}

/** A field of an authority entry: its length, then its bytes. */
function counted(data: Buffer): Buffer {
  const length = Buffer.alloc(2);
  length.writeUInt16BE(data.length);
  return Buffer.concat([length, data]);
}
