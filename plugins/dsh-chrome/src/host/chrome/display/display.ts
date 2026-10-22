import { join } from 'node:path';
import { makePrivateDirectory } from './private-directory.ts';
import { endRecordedProcesses, forgetProcesses, recordProcesses } from './recorded-processes.ts';
import { ScreenControl, type ScreenSize } from './screen-control.ts';
import { startWindowManager, type WindowManager } from './window-manager.ts';
import { writeXAuthority } from './x-authority.ts';
import { startXvnc } from './xvnc.ts';

export interface DisplayOptions {
  /** The Xvnc to run (TigerVNC's). */
  readonly xvnc: string;
  /** The window manager to run (Openbox). */
  readonly windowManager: string;
  /**
   * A directory for the VNC socket, the window manager's configuration, and the record of the
   * screen's processes. It is made private to this user: the socket takes no password. One
   * screen at a time uses it.
   */
  readonly runtimeDir: string;
  /** The screen's first size, in device pixels. */
  readonly size: ScreenSize;
}

/**
 * The screen Chrome draws on: an X server that keeps it in memory and serves it over VNC,
 * and a window manager that keeps Chrome's windows filling it. The sidebar shows it, and
 * its size follows the sidebar's.
 */
export interface Display {
  /** The X display, for Chrome to draw on. */
  readonly name: string;
  /** The X authority file that admits a program to the display (`XAUTHORITY`). */
  readonly authorityPath: string;
  /** Where VNC viewers connect. */
  readonly vncSocketPath: string;
  /** The screen's size, in device pixels. */
  readonly size: ScreenSize;
  resize(size: ScreenSize): Promise<void>;
  /** Resolves once the X server has exited. */
  readonly exited: Promise<void>;
  stop(): Promise<void>;
}

export async function startDisplay(options: DisplayOptions): Promise<Display> {
  await makePrivateDirectory(options.runtimeDir);
  await endRecordedProcesses(options.runtimeDir);
  const authorityPath = join(options.runtimeDir, 'Xauthority');
  // A new cookie for each screen: a program admitted to an earlier one is not to this one.
  await writeXAuthority(authorityPath);
  const server = await startXvnc({
    executable: options.xvnc,
    socketPath: join(options.runtimeDir, 'vnc.sock'),
    authorityPath,
    width: options.size.width,
    height: options.size.height,
  });
  let manager: WindowManager | undefined;
  let control: ScreenControl | undefined;
  try {
    manager = await startWindowManager({
      executable: options.windowManager,
      display: server.display,
      authorityPath,
      configDir: options.runtimeDir,
    });
    await recordProcesses(options.runtimeDir, [server.pid, manager.pid]);
    control = await ScreenControl.connect(server.socketPath);
  } catch (error) {
    await manager?.stop();
    await server.stop();
    await forgetProcesses(options.runtimeDir);
    throw error;
  }
  const screen = control;
  const windows = manager;
  return {
    name: server.display,
    authorityPath,
    vncSocketPath: server.socketPath,
    get size() {
      return screen.size;
    },
    resize: (size) => screen.resize(size),
    exited: server.exited,
    stop: async () => {
      screen.close();
      await windows.stop();
      await server.stop();
      await forgetProcesses(options.runtimeDir);
    },
  };
}
