import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { exitOf, startFailure, stopProcess } from '../../platform/processes.ts';

/** How long Xvnc may take to start and report its display. */
const START_TIMEOUT_MS = 15_000;

export interface XvncOptions {
  readonly executable: string;
  /** Where Xvnc listens for viewers: a Unix socket, in a directory only this user can enter. */
  readonly socketPath: string;
  /** The X authority file whose cookie admits a program to the X server. */
  readonly authorityPath: string;
  readonly width: number;
  readonly height: number;
}

/** An X server whose screen exists only in memory and is served over VNC. */
export interface XvncServer {
  /** The X display, such as `:2`, for the programs that draw on it. */
  readonly display: string;
  readonly socketPath: string;
  readonly pid: number;
  /** Resolves once Xvnc has exited. */
  readonly exited: Promise<void>;
  stop(): Promise<void>;
}

/**
 * Starts TigerVNC's Xvnc on a free display number, which it reports on file descriptor 3.
 *
 * It listens on the Unix socket only: TCP is turned off explicitly, since Xvnc otherwise also
 * listens on port 5900 plus the display number, on every interface. As an X server, it admits
 * only the programs that show the authority file's cookie. The socket takes no
 * password (`SecurityTypes None`); the directory it is in keeps other users out, and DSH's
 * authenticated route is the only way to it from elsewhere. Viewers share the screen, and
 * may set its size. They hear of Chrome's clipboard, and not of each text selected in it
 * (X's PRIMARY selection), which is not a copy.
 */
export async function startXvnc(options: XvncOptions): Promise<XvncServer> {
  await rm(options.socketPath, { force: true });
  const xvnc = spawn(
    options.executable,
    [
      '-displayfd',
      '3',
      '-auth',
      options.authorityPath,
      '-rfbunixpath',
      options.socketPath,
      '-rfbunixmode',
      String(0o600),
      '-rfbport',
      '-1',
      '-nolisten',
      'tcp',
      '-SecurityTypes',
      'None',
      '-AlwaysShared',
      '-AcceptSetDesktopSize=1',
      '-SendPrimary=0',
      '-geometry',
      `${options.width}x${options.height}`,
      '-depth',
      '24',
      '-desktop',
      'dsh-chrome',
    ],
    { stdio: ['ignore', 'ignore', 'pipe', 'pipe'] },
  );
  const exited = exitOf(xvnc);
  let diagnostics = '';
  xvnc.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    // Kept short: only the end matters when Xvnc fails to start.
    diagnostics = (diagnostics + chunk).slice(-2000);
  });
  const reported = xvnc.stdio[3] as Readable | null;
  if (reported === null) throw new Error('Xvnc started without its display pipe');
  try {
    const display = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(
              `Xvnc did not report its display within ${START_TIMEOUT_MS / 1000} s: ${lastLines(diagnostics)}`,
            ),
          ),
        START_TIMEOUT_MS,
      );
      void exited.then(() => clearTimeout(timer));
      let text = '';
      reported.setEncoding('utf8').on('data', (chunk: string) => {
        text += chunk;
        if (!text.includes('\n')) return;
        clearTimeout(timer);
        resolve(`:${text.trim()}`);
      });
      xvnc.once('error', (error) =>
        reject(
          startFailure('Xvnc', options.executable, error, 'install TigerVNC, which provides Xvnc'),
        ),
      );
      xvnc.once('exit', (code) =>
        reject(new Error(`Xvnc exited with code ${code}: ${lastLines(diagnostics)}`)),
      );
    });
    return {
      display,
      socketPath: options.socketPath,
      // Running, so it has a pid.
      pid: xvnc.pid ?? 0,
      exited,
      stop: async () => {
        await stopProcess(xvnc, exited);
        await rm(options.socketPath, { force: true });
      },
    };
  } catch (error) {
    await stopProcess(xvnc, exited);
    throw error;
  }
}

function lastLines(text: string): string {
  return text.trim().split('\n').slice(-3).join(' / ');
}
