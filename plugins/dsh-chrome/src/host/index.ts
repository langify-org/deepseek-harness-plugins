/**
 * dsh-chrome's host plugin, mounted by the Loader row that names the package itself
 * (which is also what makes DSH serve the package's browser client).
 *
 * It provides `ctx.chrome` (the Chrome dsh-chrome runs on a screen of its own, and its pages)
 * and the routes the sidebar tab connects to. The agent's tools and its context reading are
 * separate rows: `dsh-chrome-tools` and `dsh-chrome-context`.
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { ChromeService } from './chrome/chrome-service.ts';
import {
  defaultDataDir,
  defaultProfileDir,
  defaultRuntimeDir,
  defaultUserChromeDir,
  earlierProfileDirs,
} from './platform/locations.ts';
import * as viewer from './viewer/index.ts';

export const name = 'dsh-chrome';

export interface Config {
  executable: string;
  xvncExecutable: string;
  windowManagerExecutable: string;
  deviceScaleFactor: number;
  announceAutomation: boolean;
  profileDir: string;
  shareNativeHosts: boolean;
  userChromeDir: string;
  dataDir: string;
  runtimeDir: string;
}

export const Config: z<Config> = z.object({
  executable: z.string().default('google-chrome-stable').description('The Chrome to run.'),
  xvncExecutable: z
    .string()
    .default('Xvnc')
    .description(
      "TigerVNC's Xvnc: the X server Chrome draws on, which serves its screen over VNC.",
    ),
  windowManagerExecutable: z
    .string()
    .default('openbox')
    .description("Openbox: the window manager that keeps Chrome's windows filling the screen."),
  deviceScaleFactor: z
    .number()
    .min(1)
    .max(4)
    .default(2)
    .description(
      "How many of the screen's pixels a CSS pixel of Chrome takes. 2 is sharp on high-density " +
        'displays and still clear on others; 1 sends a quarter of the pixels.',
    ),
  announceAutomation: z
    .boolean()
    .default(false)
    .description(
      'Tell pages that Chrome is under automated control (navigator.webdriver), as Chrome ' +
        'would for the pipe dsh-chrome controls it through. Off by default, since Google ' +
        'refuses to sign in to a browser that says so ("This browser or app may not be ' +
        'secure"), and other sites take whoever uses it for a bot, you included when you ' +
        'work by hand.',
    ),
  profileDir: z
    .string()
    .default(defaultProfileDir())
    .description('The Chrome profile dsh-chrome runs: its user data directory.'),
  shareNativeHosts: z
    .boolean()
    .default(true)
    .description(
      "Let the profile's extensions reach the native apps your own Chrome's reach, such as " +
        "1Password's desktop app, by linking their native messaging manifests into it.",
    ),
  userChromeDir: z
    .string()
    .default(defaultUserChromeDir())
    .description("Your own Chrome's user data directory, whose native apps are shared."),
  dataDir: z
    .string()
    .default(defaultDataDir())
    .description('Where dsh-chrome keeps what it records between starts.'),
  runtimeDir: z
    .string()
    .default(defaultRuntimeDir())
    .description("Where the screen's VNC socket is; only you should be able to enter it."),
});

export async function apply(ctx: Context, config: Config): Promise<void> {
  // This row counts as started once `ctx.chrome` is: DSH reports the rows that use it
  // (dsh-chrome-tools, dsh-chrome-context) as not activated if they are checked earlier.
  await ctx.plugin(ChromeService, {
    chromeExecutable: config.executable,
    xvncExecutable: config.xvncExecutable,
    windowManagerExecutable: config.windowManagerExecutable,
    deviceScaleFactor: config.deviceScaleFactor,
    announceAutomation: config.announceAutomation,
    profileDir: config.profileDir,
    earlierProfileDirs: earlierProfileDirs(),
    shareNativeHosts: config.shareNativeHosts,
    userChromeDir: config.userChromeDir,
    dataDir: config.dataDir,
    runtimeDir: config.runtimeDir,
  });
  ctx.plugin(viewer);
}
