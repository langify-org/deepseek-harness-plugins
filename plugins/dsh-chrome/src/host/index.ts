/**
 * dsh-chrome's host plugin, mounted by the Loader row that names the package itself
 * (which is also what makes DSH serve the package's browser client).
 *
 * It provides `ctx.chrome` (the Chrome dsh-chrome runs on a screen of its own, and its pages)
 * and the routes the sidebar tab connects to. The agent's tools and its context reading are
 * separate rows: `dsh-chrome-tools` and `dsh-chrome-context`.
 *
 * Its configuration schema is the one definition of its settings. The settings a user
 * changes while dsh-chrome runs are volatile: DSH's plugin settings page edits them, in a
 * form the browser client draws from this schema, and the plugin goes on running; Chrome
 * takes them when it starts again. The others (paths, and the programs behind the screen)
 * are set in the profile's configuration, and changing one restarts the plugin.
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import {
  ChromeService,
  type ChromeSettings,
  DEVICE_SCALE_FACTORS,
  WEBGL_MODES,
  type WebglMode,
} from './chrome/chrome-service.ts';
import {
  defaultDataDir,
  defaultProfileDir,
  defaultRuntimeDir,
  defaultUserChromeDir,
  earlierProfileDirs,
} from './platform/locations.ts';
import * as viewer from './viewer/index.ts';

export const name = 'dsh-chrome';

/** A setting the user changes while the plugin runs: read it when it is used. */
export interface Setting<T> {
  get(): T;
}

/** The settings, each as the Loader holds it: the volatile fields of the schema. */
export type Settings = { [K in keyof ChromeSettings]: Setting<ChromeSettings[K]> };

export interface Config extends Settings {
  xvncExecutable: string;
  windowManagerExecutable: string;
  profileDir: string;
  userChromeDir: string;
  dataDir: string;
  runtimeDir: string;
}

const WEBGL_DESCRIPTIONS: Readonly<Record<WebglMode, string>> = {
  gpu: 'On your GPU, through Vulkan. Pages get no WebGL on a machine without a Vulkan driver.',
  'gpu-or-cpu':
    'On your GPU, else on the CPU: slower, and a larger target for a hostile page, which is why Chrome refuses it by itself.',
  off: 'No WebGL: Chrome finds no GPU on the screen it draws on.',
};

export const Config = z.object({
  executable: z
    .string()
    .default('google-chrome-stable')
    .description('The Chrome to run: a command, or its path.')
    .volatile(),
  deviceScaleFactor: z
    .union([
      z
        .const('auto')
        .description(
          'The pixel ratio of the display you work in Chrome on, when Chrome starts: sharp on ' +
            'high-density displays, and no more pixels than other displays show.',
        ),
      z
        .number()
        .min(DEVICE_SCALE_FACTORS.min)
        .max(DEVICE_SCALE_FACTORS.max)
        .step(DEVICE_SCALE_FACTORS.step)
        .description('This many, whatever the display: 2 sends four times the pixels of 1.'),
    ])
    .default('auto')
    .description("How many of the screen's pixels a CSS pixel of Chrome takes.")
    .volatile(),
  announceAutomation: z
    .boolean()
    .default(false)
    .description(
      'Tell pages that Chrome is under automated control (navigator.webdriver), as Chrome ' +
        'would for the pipe dsh-chrome controls it through. Off by default, since Google ' +
        'refuses to sign in to a browser that says so ("This browser or app may not be ' +
        'secure"), and other sites take whoever uses it for a bot, you included when you ' +
        'work by hand.',
    )
    .volatile(),
  webgl: z
    .union(WEBGL_MODES.map((mode) => z.const(mode).description(WEBGL_DESCRIPTIONS[mode])))
    .default('gpu')
    .description('How Chrome draws WebGL, for maps, 3D and some editors.')
    .volatile(),
  shareNativeHosts: z
    .boolean()
    .default(true)
    .description(
      "Let the profile's extensions reach the native apps your own Chrome's reach, such as " +
        "1Password's desktop app, by linking their native messaging manifests into it.",
    )
    .volatile(),
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
  profileDir: z
    .string()
    .default(defaultProfileDir())
    .description('The Chrome profile dsh-chrome runs: its user data directory.'),
  userChromeDir: z
    .string()
    .default(defaultUserChromeDir())
    .description(
      "Your own Chrome's user data directory: whose native apps are shared, and whose profiles can be copied.",
    ),
  dataDir: z
    .string()
    .default(defaultDataDir())
    .description('Where dsh-chrome keeps what it records between starts.'),
  runtimeDir: z
    .string()
    .default(defaultRuntimeDir())
    .description("Where the screen's VNC socket is; only you should be able to enter it."),
});

/** The settings' keys: the schema's volatile fields, which the type above has, checked below. */
const SETTING_KEYS = Object.entries(Config.dict ?? {}).flatMap(([key, field]) =>
  field.meta?.volatile ? [key as keyof ChromeSettings] : [],
);

/** The settings as they are now. */
function settingsOf(config: Settings): ChromeSettings {
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, config[key].get()]),
  ) as unknown as ChromeSettings;
}

/** What the Loader passes to {@link apply}: the schema's output, checked to be {@link Config}. */
type ParsedConfig = ReturnType<typeof Config>;
export type ConfigMatchesSchema = [ParsedConfig] extends [Config]
  ? [Config] extends [Pick<ParsedConfig, keyof Config>]
    ? true
    : never
  : never;
const configMatchesSchema: ConfigMatchesSchema = true;
void configMatchesSchema;

export async function apply(ctx: Context, config: Config): Promise<void> {
  // The Loader updates the settings in place, and tells this row only; this row provides
  // `ctx.chrome` without injecting it, so it may not reach it, and tells the service instead.
  const settingsListeners = new Set<() => void>();
  ctx.on('loader/volatile-update', () => {
    for (const listener of [...settingsListeners]) listener();
  });
  // This row counts as started once `ctx.chrome` is: DSH reports the rows that use it
  // (dsh-chrome-tools, dsh-chrome-context) as not activated if they are checked earlier.
  await ctx.plugin(ChromeService, {
    xvncExecutable: config.xvncExecutable,
    windowManagerExecutable: config.windowManagerExecutable,
    profileDir: config.profileDir,
    earlierProfileDirs: earlierProfileDirs(),
    userChromeDir: config.userChromeDir,
    dataDir: config.dataDir,
    runtimeDir: config.runtimeDir,
    settings: () => settingsOf(config),
    onSettingsChange: (listener) => {
      settingsListeners.add(listener);
      return () => settingsListeners.delete(listener);
    },
  });
  ctx.plugin(viewer);
}
