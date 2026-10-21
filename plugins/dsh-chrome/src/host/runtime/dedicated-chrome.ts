import { type ChildProcess, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { CONNECTOR_EXTENSION_ID } from '../../protocol/connector-identity.ts';
import { BrowserPipe } from './browser-pipe.ts';
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
  // Chrome inherits the display only from here on; until it runs, the display is ours to stop.
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
  // A Chrome that could not start (not on PATH, say) has exited as well. Without a listener,
  // the error would be thrown, and an uncaught error ends DSH.
  const exited = new Promise<void>((resolve) => {
    chrome.once('exit', () => resolve());
    chrome.once('error', () => resolve());
  });
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
    throw new Error(
      `could not start the dedicated Chrome (${options.executable}) with the connector: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
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
  try {
    const display = await new Promise<string>((resolve, reject) => {
      let text = '';
      reported.setEncoding('utf8');
      reported.on('data', (chunk: string) => {
        text += chunk;
        if (text.includes('\n')) resolve(`:${text.trim()}`);
      });
      reported.on('error', reject);
      xvfb.once('error', reject);
      xvfb.once('exit', (code) => reject(new Error(`Xvfb exited with code ${code}`)));
    });
    return { display, stop: () => stopProcess(xvfb) };
  } catch (error) {
    await stopProcess(xvfb);
    throw new Error(
      `could not start Xvfb for the dedicated Chrome's virtual display (install Xvfb, or set ` +
        `dedicatedProfile.display to "desktop"): ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function stopProcess(child: ChildProcess): Promise<void> {
  // A process that never started, or has ended, has nothing to stop.
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), QUIT_GRACE_MS);
  await exited;
  clearTimeout(timer);
}
