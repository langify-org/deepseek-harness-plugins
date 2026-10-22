import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The preferences dsh-chrome sets in its profile, merged into what Chrome keeps there.
 *
 * `browser.custom_chrome_frame: false` is Chrome's "Use system title bar and borders". The
 * window manager draws no title bar, so Chrome then shows no minimize, maximize or close
 * buttons either: a minimized window could not be brought back, since the screen has no
 * task bar. Tabs still close, and the window with its last tab.
 */
const PREFERENCES = { browser: { custom_chrome_frame: false } } as const;

/**
 * Writes the preferences into the profile's `Default/Preferences`, before Chrome starts:
 * Chrome reads the file when it starts, and rewrites it as it runs.
 * @returns why the file could not be written, if it could not; Chrome still starts.
 */
export async function setChromePreferences(profileDir: string): Promise<string | undefined> {
  const dir = join(profileDir, 'Default');
  const path = join(dir, 'Preferences');
  try {
    const current = await readFile(path, 'utf8').then(
      (text): unknown => JSON.parse(text),
      (error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
        throw error;
      },
    );
    const merged = mergePreferences(isRecord(current) ? current : {}, PREFERENCES);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // Written aside and moved in, so that a failure leaves Chrome's own file whole.
    const staged = `${path}.dsh-chrome`;
    await writeFile(staged, JSON.stringify(merged), { mode: 0o600 });
    await rename(staged, path);
    return undefined;
  } catch (error) {
    return `could not set Chrome's preferences in ${path}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** The preferences with the given ones set in them, the rest kept as they are. */
export function mergePreferences(
  current: Readonly<Record<string, unknown>>,
  wanted: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...current };
  for (const [key, value] of Object.entries(wanted)) {
    const existing = merged[key];
    merged[key] = isRecord(value) && isRecord(existing) ? mergePreferences(existing, value) : value;
  }
  return merged;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
