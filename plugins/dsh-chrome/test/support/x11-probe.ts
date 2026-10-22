import { createConnection } from 'node:net';

/** How an X server answered a connection: admitted, or refused and why. */
export type XSetupAnswer =
  | { readonly admitted: true }
  | { readonly admitted: false; readonly reason: string };

/**
 * Opens a connection to an X server's Unix socket, as any X program does, showing the cookie
 * if one is given, and reads whether the server admits it.
 */
export function probeXServer(
  socketPath: string,
  cookie?: { name: string; data: Buffer },
): Promise<XSetupAnswer> {
  const name = Buffer.from(cookie?.name ?? '', 'latin1');
  const data = cookie?.data ?? Buffer.alloc(0);
  const pad = (length: number) => Buffer.alloc((4 - (length % 4)) % 4);
  const header = Buffer.alloc(12);
  header.write('l', 0, 'latin1');
  header.writeUInt16LE(11, 2);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(name.length, 6);
  header.writeUInt16LE(data.length, 8);
  const request = Buffer.concat([header, name, pad(name.length), data, pad(data.length)]);
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let answer = Buffer.alloc(0);
    socket.on('error', reject);
    socket.on('connect', () => socket.write(request));
    socket.on('data', (chunk: Buffer) => {
      answer = Buffer.concat([answer, chunk]);
      if (answer.length < 8) return;
      socket.destroy();
      if (answer[0] === 1) {
        resolve({ admitted: true });
        return;
      }
      // A refusal: its reason's length, and after the 8-byte header, the reason.
      const reasonLength = answer[1] ?? 0;
      resolve({ admitted: false, reason: answer.subarray(8, 8 + reasonLength).toString('latin1') });
    });
  });
}

/** The cookie an X authority file holds, from its first entry. */
export function cookieOf(file: Buffer): { name: string; data: Buffer } {
  let offset = 2;
  const field = () => {
    const length = file.readUInt16BE(offset);
    const value = file.subarray(offset + 2, offset + 2 + length);
    offset += 2 + length;
    return value;
  };
  field();
  field();
  const name = field().toString('latin1');
  return { name, data: field() };
}
