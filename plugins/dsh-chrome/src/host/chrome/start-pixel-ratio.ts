import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * The pixel ratio an `auto` scale starts Chrome at, kept between dsh-chrome's starts in a file
 * of its own: a Chrome the agent starts before any viewer asks for one, after DSH starts, then
 * draws for the display the user last worked on, not at 1.
 */

/** The ratio the file keeps; none when it is missing or holds no positive number. */
export async function readStartPixelRatio(path: string): Promise<number | undefined> {
  try {
    const record: unknown = JSON.parse(await readFile(path, 'utf8'));
    const pixelRatio =
      typeof record === 'object' && record !== null && 'pixelRatio' in record
        ? record.pixelRatio
        : undefined;
    return typeof pixelRatio === 'number' && Number.isFinite(pixelRatio) && pixelRatio > 0
      ? pixelRatio
      : undefined;
  } catch {
    return undefined;
  }
}

export async function writeStartPixelRatio(path: string, pixelRatio: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify({ pixelRatio })}\n`);
}
