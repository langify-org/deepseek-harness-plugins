import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import type { Log } from '../../platform/log.ts';
import { exitOf, exitsWithin, startFailure, stopProcess } from '../../platform/processes.ts';
import { CdpConnection } from '../cdp/cdp-connection.ts';
import { PipeTransport } from '../cdp/pipe-transport.ts';

/** How long Chrome may take to start and answer its first command. */
const START_TIMEOUT_MS = 30_000;
/** How long Chrome may take to save its profile and exit when asked to close. */
const CLOSE_TIMEOUT_MS = 5000;

export interface ChromeOptions {
  readonly executable: string;
  readonly profileDir: string;
  /** The X display Chrome draws on. */
  readonly display: string;
  /** The X authority file that admits Chrome to the display. */
  readonly authorityPath: string;
  /** How many device pixels a CSS pixel takes: 2 draws sharply on high-density screens. */
  readonly deviceScaleFactor: number;
  readonly log: Log;
}

/** Chrome, running on its display, and the CDP connection over its launch pipe. */
export interface ChromeProcess {
  readonly connection: CdpConnection;
  readonly version: string;
  /** Resolves once Chrome has exited. */
  readonly exited: Promise<void>;
  /** Asks Chrome to close, saving its profile, and ends it if it does not. */
  close(): Promise<void>;
}

/**
 * Starts Chrome on the display, with the debugging pipe as its only control channel: no
 * debugging port is opened, and only this process holds the pipe's ends. Chrome reads on its
 * file descriptor 3 and writes on 4, which DSH's subprocess service cannot provide, so
 * Chrome is spawned directly; it still ends with the plugin.
 */
export async function launchChrome(options: ChromeOptions): Promise<ChromeProcess> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    DISPLAY: options.display,
    XAUTHORITY: options.authorityPath,
  };
  delete env['WAYLAND_DISPLAY'];
  const chrome = spawn(
    options.executable,
    [
      `--user-data-dir=${options.profileDir}`,
      '--remote-debugging-pipe',
      '--no-first-run',
      '--no-default-browser-check',
      '--ozone-platform=x11',
      `--force-device-scale-factor=${options.deviceScaleFactor}`,
    ],
    { env, stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );
  const exited = exitOf(chrome);
  const spawned = new Promise<void>((resolve, reject) => {
    chrome.once('spawn', () => resolve());
    chrome.once('error', (error) =>
      reject(
        startFailure(
          'Chrome',
          options.executable,
          error,
          'install Google Chrome, or set executable',
        ),
      ),
    );
  });
  const transport = new PipeTransport(chrome.stdio[3] as Writable, chrome.stdio[4] as Readable);
  const connection = new CdpConnection(transport, options.log);
  try {
    await spawned;
    const { product } = await connection.send('Browser.getVersion', undefined, {
      timeoutMs: START_TIMEOUT_MS,
    });
    return {
      connection,
      version: product,
      exited,
      close: async () => {
        await connection
          .send('Browser.close', undefined, { timeoutMs: CLOSE_TIMEOUT_MS })
          .catch(() => {});
        if (!(await exitsWithin(exited, CLOSE_TIMEOUT_MS))) await stopProcess(chrome, exited);
      },
    };
  } catch (error) {
    await stopProcess(chrome, exited);
    throw error;
  }
}
