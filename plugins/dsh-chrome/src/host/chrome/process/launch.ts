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

/**
 * How Chrome draws WebGL. The screen is drawn in memory, with no GPU of its own, so Chrome
 * finds no OpenGL to draw with, and turns WebGL off: Vulkan reaches the machine's GPU
 * without the screen.
 *
 * - `gpu`: on the machine's GPU, through Vulkan; none on a machine without a Vulkan driver.
 * - `gpu-or-cpu`: on the GPU, else on the CPU (Mesa's software Vulkan or OpenGL), which
 *   Chrome otherwise refuses: slower, and a larger target for a hostile page.
 * - `off`: as Chrome decides by itself, which here is without WebGL.
 */
export type WebglMode = 'gpu' | 'gpu-or-cpu' | 'off';

export const WEBGL_MODES: readonly WebglMode[] = ['gpu', 'gpu-or-cpu', 'off'];

export interface ChromeOptions {
  readonly executable: string;
  readonly profileDir: string;
  /** The X display Chrome draws on. */
  readonly display: string;
  /** The X authority file that admits Chrome to the display. */
  readonly authorityPath: string;
  /** How many device pixels a CSS pixel takes: 2 draws sharply on high-density screens. */
  readonly deviceScaleFactor: number;
  /**
   * Whether pages are told that Chrome is under automated control (`navigator.webdriver`),
   * as Chrome tells them of a browser debugged through a pipe.
   */
  readonly announceAutomation: boolean;
  readonly webgl: WebglMode;
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
  const chrome = spawn(options.executable, chromeArguments(options), {
    env,
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  });
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

/**
 * Chrome's command line. Chrome opens no window of its own: each DSH session opens its own,
 * on its own part of the screen.
 *
 * Chrome takes a browser debugged through a pipe for one under automated control, and tells
 * pages so (`navigator.webdriver`); unless that is wanted, the flag behind it is turned off.
 * Google refuses to sign in to a browser that says so ("This browser or app may not be
 * secure"), and other sites take whoever uses it for a bot, the user working by hand
 * included. Chrome warns of that flag with a bar in the window it opens at its start, which
 * only a managed policy turns off; opening none, it shows no bar. It warns of none of the
 * others.
 *
 * WebGL on the GPU draws through Vulkan, and Chrome composites pages on the CPU: the screen is
 * in memory, so a frame composited on the GPU is read back from it. That cost Chrome three to
 * four times the CPU on an animation, and twice on a page that is one WebGL canvas (measured
 * in docs/design.md).
 */
export function chromeArguments(
  options: Pick<ChromeOptions, 'profileDir' | 'deviceScaleFactor' | 'announceAutomation' | 'webgl'>,
): string[] {
  return [
    `--user-data-dir=${options.profileDir}`,
    '--remote-debugging-pipe',
    '--no-first-run',
    '--no-default-browser-check',
    '--no-startup-window',
    '--ozone-platform=x11',
    `--force-device-scale-factor=${options.deviceScaleFactor}`,
    ...(options.announceAutomation ? [] : ['--disable-blink-features=AutomationControlled']),
    ...WEBGL_ARGUMENTS[options.webgl],
  ];
}

const WEBGL_ARGUMENTS: Readonly<Record<WebglMode, readonly string[]>> = {
  gpu: ['--use-angle=vulkan', '--disable-gpu-compositing'],
  'gpu-or-cpu': ['--use-angle=vulkan', '--ignore-gpu-blocklist', '--disable-gpu-compositing'],
  off: [],
};
