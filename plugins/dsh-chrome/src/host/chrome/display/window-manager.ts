import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exitOf, startFailure, stopProcess } from '../../platform/processes.ts';

export interface WindowManagerOptions {
  readonly executable: string;
  /** The X display it manages. */
  readonly display: string;
  /** The X authority file that admits it to the display. */
  readonly authorityPath: string;
  /** Where its configuration is written. */
  readonly configDir: string;
}

export interface WindowManager {
  readonly pid: number;
  readonly exited: Promise<void>;
  stop(): Promise<void>;
}

/**
 * Openbox, configured so that each Chrome window fills the monitor it is on, without
 * decorations or borders. Chrome draws its own tabs; the window manager keeps its windows
 * sized to their monitors as the monitors follow the viewers (on the monitor each overlaps
 * most, which the Chrome service corrects when that is another session's), brings a window
 * Chrome activates to the front, and gives the focus to a new window and to the window
 * clicked. Dialogs of their own, such as a file chooser,
 * keep their size. It has no keys or menus of its own, so that every key reaches Chrome.
 *
 * A window a page opens (a sign-in popup) stays above Chrome's, where Chrome puts it: on its
 * opener's monitor. It has a title bar whose only button closes it: there is no taskbar to
 * find a window again that went behind another, and the browser that shows DSH keeps
 * Chrome's shortcut for closing a window.
 */
export const OPENBOX_CONFIG = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <focus><focusNew>yes</focusNew><followMouse>no</followMouse></focus>
  <placement><policy>Smart</policy><center>yes</center></placement>
  <theme><keepBorder>no</keepBorder><titleLayout>LC</titleLayout></theme>
  <desktops><number>1</number></desktops>
  <margins><top>0</top><bottom>0</bottom><left>0</left><right>0</right></margins>
  <keyboard></keyboard>
  <mouse>
    <context name="Client">
      <mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="Middle" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="Right" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
    </context>
    <context name="Titlebar">
      <mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="Left" action="Drag"><action name="Move"/></mousebind>
    </context>
    <context name="Close">
      <mousebind button="Left" action="Press"><action name="Focus"/><action name="Raise"/></mousebind>
      <mousebind button="Left" action="Click"><action name="Close"/></mousebind>
    </context>
  </mouse>
  <applications>
    <application class="*"><decor>no</decor></application>
    <application class="*" type="normal"><maximized>yes</maximized></application>
    <application class="*" role="pop-up">
      <decor>yes</decor><maximized>no</maximized><layer>above</layer>
    </application>
  </applications>
</openbox_config>
`;

/**
 * Starts the window manager on the display. It takes over the windows already there, so
 * it may start alongside Chrome.
 */
export async function startWindowManager(options: WindowManagerOptions): Promise<WindowManager> {
  const configPath = join(options.configDir, 'openbox.xml');
  await writeFile(configPath, OPENBOX_CONFIG);
  const env: Record<string, string | undefined> = {
    ...process.env,
    DISPLAY: options.display,
    XAUTHORITY: options.authorityPath,
  };
  delete env['WAYLAND_DISPLAY'];
  const manager = spawn(options.executable, ['--config-file', configPath, '--sm-disable'], {
    env,
    stdio: 'ignore',
  });
  const exited = exitOf(manager);
  await new Promise<void>((resolve, reject) => {
    manager.once('spawn', () => resolve());
    manager.once('error', (error) =>
      reject(startFailure('the window manager', options.executable, error, 'install Openbox')),
    );
  });
  // Spawned, so it has a pid.
  const pid = manager.pid ?? 0;
  return { pid, exited, stop: () => stopProcess(manager, exited) };
}
