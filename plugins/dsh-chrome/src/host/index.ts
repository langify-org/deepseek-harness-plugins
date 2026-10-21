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
import {
  ChromeService,
  DAILY_PROFILE,
  DEDICATED_PROFILE,
  type ProfileName,
} from './runtime/chrome-service.ts';
import {
  defaultChromeUserDataDir,
  defaultConnectorSocketPath,
  defaultDataDir,
  defaultDedicatedUserDataDir,
} from './runtime/locations.ts';
import * as viewer from './view/index.ts';

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
    display: 'virtual' | 'desktop';
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
        .default(true)
        .description('Let the connector in your own Chrome profile reach this DSH.'),
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
        .default(false)
        .description(
          'Start a separate Chrome profile that dsh-chrome owns, when a page asks for it.',
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
          "'virtual' runs it on a private Xvfb display that keeps working while the screen is locked; " +
            "'desktop' shows its window, for signing in to sites the first time.",
        ),
    })
    .default({}),
  defaultProfile: z
    .union([DAILY_PROFILE, DEDICATED_PROFILE] as const)
    .default(DAILY_PROFILE)
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

export function apply(ctx: Context, config: Config): void {
  ctx.plugin(ChromeService, {
    dailyProfile: config.dailyProfile,
    dedicatedProfile: config.dedicatedProfile,
    defaultProfile: config.defaultProfile,
    dataDir: config.dataDir,
    connectorSocketPath: config.connectorSocketPath,
    nodeExecutable: config.nodeExecutable,
  });
  ctx.plugin(viewer, config.viewer);
}
