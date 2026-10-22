/**
 * dsh-chrome's host plugin, mounted by the Loader row that names the package itself
 * (which is also what makes DSH serve the package's browser client).
 *
 * It provides `ctx.chrome` (connected browsers and the pages the plugin controls) and
 * the viewer route the sidebar tab connects to. The agent's tools and its context
 * reading are separate rows: `dsh-chrome-tools` and `dsh-chrome-context`.
 */
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import type { DedicatedDisplay } from '../protocol/viewer.ts';
import {
  ChromeService,
  DAILY_PROFILE,
  DEDICATED_PROFILE,
  type ProfileName,
} from './chrome/chrome-service.ts';
import {
  defaultChromeUserDataDir,
  defaultConnectorSocketPath,
  defaultDataDir,
  defaultDedicatedUserDataDir,
} from './platform/locations.ts';
import * as viewer from './viewer/index.ts';

export const name = 'dsh-chrome';

export interface Config {
  dailyProfile: {
    enabled: boolean;
    userDataDir: string;
  };
  dedicatedProfile: {
    enabled: boolean;
    executable: string;
    userDataDir: string;
    display: DedicatedDisplay;
    shareNativeHosts: boolean;
  };
  defaultProfile: ProfileName;
  dataDir: string;
  connectorSocketPath: string;
  nodeExecutable: string;
  viewer: {
    jpegQuality: number;
    hiddenFrameIntervalMs: number;
    maxDeviceScaleFactor: number;
  };
}

export const Config: z<Config> = z.object({
  dailyProfile: z
    .object({
      enabled: z
        .boolean()
        .default(false)
        .description(
          'Let the connector in your own Chrome profile reach this DSH. Its pages open in a ' +
            'window of your Chrome, on your desktop.',
        ),
      userDataDir: z
        .string()
        .default(defaultChromeUserDataDir())
        .description("Chrome's user data directory for your own profile."),
    })
    .default({}),
  dedicatedProfile: z
    .object({
      enabled: z
        .boolean()
        .default(true)
        .description(
          'Run a Chrome of its own for dsh-chrome, on a profile of its own, started when a page ' +
            'opens. Its windows stay out of sight; the sidebar shows its pages.',
        ),
      executable: z.string().default('google-chrome-stable').description('The Chrome to start.'),
      userDataDir: z
        .string()
        .default(defaultDedicatedUserDataDir())
        .description("The dedicated profile's user data directory."),
      display: z
        .union(['virtual', 'desktop'] as const)
        .default('virtual')
        .description(
          "'virtual' keeps its windows on a private Xvfb display, which also works while the " +
            "screen is locked; 'desktop' shows them. The sidebar can show them for a while, to " +
            'set the profile up.',
        ),
      shareNativeHosts: z
        .boolean()
        .default(true)
        .description(
          "Let its extensions reach the native apps your own Chrome's reach, such as " +
            "1Password's desktop app, by linking their native messaging manifests.",
        ),
    })
    .default({}),
  defaultProfile: z
    .union([DAILY_PROFILE, DEDICATED_PROFILE] as const)
    .default(DEDICATED_PROFILE)
    .description('The profile new pages open in.'),
  dataDir: z
    .string()
    .default(defaultDataDir())
    .description('Where the connector extension and relay are kept for Chrome to load.'),
  connectorSocketPath: z
    .string()
    .default(defaultConnectorSocketPath())
    .description('The Unix socket the relay connects to.'),
  nodeExecutable: z
    .string()
    .default(process.execPath)
    .description(
      'The Node.js that Chrome runs the connector relay with. Defaults to the one running DSH; ' +
        'set it when that one cannot run outside DSH (a bundled Node on NixOS without nix-ld).',
    ),
  viewer: z
    .object({
      jpegQuality: z.natural().min(1).max(100).default(70).description('JPEG quality of frames.'),
      hiddenFrameIntervalMs: z
        .natural()
        .min(50)
        .default(250)
        .description('How often a hidden page is captured while someone views it.'),
      maxDeviceScaleFactor: z
        .number()
        .min(1)
        .max(4)
        .default(2)
        .description('The highest pixel density the page renders at for a viewer.'),
    })
    .default({}),
});

export async function apply(ctx: Context, config: Config): Promise<void> {
  // This row counts as started once `ctx.chrome` is: DSH reports the rows that use it
  // (dsh-chrome-tools, dsh-chrome-context) as not activated if they are checked earlier.
  await ctx.plugin(ChromeService, {
    dailyProfile: config.dailyProfile,
    dedicatedProfile: config.dedicatedProfile,
    defaultProfile: config.defaultProfile,
    dataDir: config.dataDir,
    connectorSocketPath: config.connectorSocketPath,
    nodeExecutable: config.nodeExecutable,
  });
  ctx.plugin(viewer, config.viewer);
}
