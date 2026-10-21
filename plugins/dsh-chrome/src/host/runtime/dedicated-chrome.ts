import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { Readable, Writable } from 'node:stream';
import { CONNECTOR_EXTENSION_ID } from '../../protocol/connector-identity.ts';
import type { Log } from './log.ts';

export interface DedicatedChromeOptions {
  /** The Chrome executable: a name looked up on PATH, or an absolute path. */
  readonly executable: string;
  /** The profile the plugin owns. Chrome creates it on first launch. */
  readonly userDataDir: string;
  /** The unpacked connector to load into the profile. */
  readonly extensionDir: string;
  /**
   * Where Chrome's windows appear: a private virtual display (Xvfb), which keeps working
   * while the screen is locked, or the user's desktop.
   */
  readonly display: 'virtual' | 'desktop';
  readonly log: Log;
}

export interface DedicatedChrome {
  /** Settles when Chrome exits, for whatever reason. */
  readonly exited: Promise<void>;
  /** Asks Chrome to quit, and stops the virtual display. */
  close(): Promise<void>;
}

/** How long Chrome gets to quit cleanly before it is killed. */
const QUIT_GRACE_MS = 5000;

/**
 * Starts Chrome on a profile the plugin owns, with the connector loaded.
 *
 * Branded Chrome stopped loading extensions from the command line (Chrome 137), so the
 * connector is loaded with CDP's `Extensions.loadUnpacked` over `--remote-debugging-pipe`.
 * That pipe belongs to this process alone — no debugging port is opened — and carries
 * nothing else: from then on the plugin controls this Chrome through its connector, as
 * it controls the daily profile.
 *
 * Chrome reads the pipe on file descriptor 3 and writes on 4, which DSH's subprocess
 * service cannot provide, so Chrome is spawned directly. It still ends with the plugin.
 */
export async function launchDedicatedChrome(
  options: DedicatedChromeOptions,
): Promise<DedicatedChrome> {
  await mkdir(options.userDataDir, { recursive: true, mode: 0o700 });
  const virtualDisplay = options.display === 'virtual' ? await startVirtualDisplay() : undefined;
  const env = { ...process.env };
  const displayArgs: string[] = [];
  if (virtualDisplay !== undefined) {
    env['DISPLAY'] = virtualDisplay.display;
    delete env['WAYLAND_DISPLAY'];
    displayArgs.push('--ozone-platform=x11');
  }

  const chrome = spawn(
    options.executable,
    [
      `--user-data-dir=${options.userDataDir}`,
      '--remote-debugging-pipe',
      '--enable-unsafe-extension-debugging',
      '--no-first-run',
      '--no-default-browser-check',
      ...displayArgs,
      'about:blank',
    ],
    { env, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise<void>((resolve) => chrome.once('exit', () => resolve()));
  void exited.then(() => virtualDisplay?.stop());

  const pipe = new BrowserPipe(chrome);
  try {
    const loaded = await pipe.call('Extensions.loadUnpacked', { path: options.extensionDir });
    const id =
      typeof loaded === 'object' && loaded !== null && 'id' in loaded ? loaded.id : undefined;
    if (id !== CONNECTOR_EXTENSION_ID) {
      options.log.warn(
        `dsh-chrome: the loaded connector has id ${String(id)}, not ${CONNECTOR_EXTENSION_ID}`,
      );
    }
  } catch (error) {
    await stopProcess(chrome);
    await virtualDisplay?.stop();
    throw new Error(`could not load the connector into the dedicated Chrome: ${String(error)}`);
  }

  return {
    exited,
    close: async () => {
      // Browser.close lets Chrome save the profile; killing is the fallback.
      await pipe.call('Browser.close', {}).catch(() => {});
      await stopProcess(chrome);
      await virtualDisplay?.stop();
    },
  };
}

/**
 * Chrome's end of `--remote-debugging-pipe`: JSON messages, each followed by a NUL byte.
 * Only the launcher uses it, for a handful of browser-level commands.
 */
class BrowserPipe {
  readonly #input: Writable;
  readonly #pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  #nextId = 1;
  #buffered = '';

  constructor(chrome: ChildProcess) {
    const input = chrome.stdio[3] as Writable | null;
    const output = chrome.stdio[4] as Readable | null;
    if (input === null || output === null)
      throw new Error('Chrome started without its debugging pipe');
    this.#input = input;
    output.setEncoding('utf8');
    output.on('data', (chunk: string) => this.#receive(chunk));
    chrome.once('exit', () => {
      for (const pending of this.#pending.values()) pending.reject(new Error('Chrome exited'));
      this.#pending.clear();
    });
  }

  call(method: string, params: object): Promise<unknown> {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#input.write(`${JSON.stringify({ id, method, params })}\0`);
    });
  }

  #receive(chunk: string): void {
    this.#buffered += chunk;
    for (let end = this.#buffered.indexOf('\0'); end !== -1; end = this.#buffered.indexOf('\0')) {
      const message = JSON.parse(this.#buffered.slice(0, end)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      this.#buffered = this.#buffered.slice(end + 1);
      const pending = message.id === undefined ? undefined : this.#pending.get(message.id);
      if (pending === undefined || message.id === undefined) continue; // an event
      this.#pending.delete(message.id);
      if (message.error === undefined) pending.resolve(message.result);
      else pending.reject(new Error(message.error.message));
    }
  }
}

interface VirtualDisplay {
  readonly display: string;
  stop(): Promise<void>;
}

/** An Xvfb server on a free display number, which Xvfb reports on file descriptor 3. */
async function startVirtualDisplay(): Promise<VirtualDisplay> {
  const xvfb = spawn(
    'Xvfb',
    ['-displayfd', '3', '-screen', '0', '1920x1080x24', '-nolisten', 'tcp'],
    {
      stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
    },
  );
  const reported = xvfb.stdio[3] as Readable | null;
  if (reported === null) throw new Error('Xvfb started without its display pipe');
  const display = await new Promise<string>((resolve, reject) => {
    let text = '';
    reported.setEncoding('utf8');
    reported.on('data', (chunk: string) => {
      text += chunk;
      if (text.includes('\n')) resolve(`:${text.trim()}`);
    });
    xvfb.once('error', reject);
    xvfb.once('exit', (code) => reject(new Error(`Xvfb exited with code ${code}`)));
  });
  return { display, stop: () => stopProcess(xvfb) };
}

async function stopProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), QUIT_GRACE_MS);
  await exited;
  clearTimeout(timer);
}
