import { chmod, cp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NATIVE_HOST_NAME } from '../../protocol/connector.ts';
import { CONNECTOR_EXTENSION_ID } from '../../protocol/connector-identity.ts';

/** A Chrome user data directory in which the connector may run. */
export interface ConnectorProfile {
  /** The name the relay reports for connections from this profile. */
  readonly name: string;
  /** Chrome reads native host manifests from `<userDataDir>/NativeMessagingHosts`. */
  readonly userDataDir: string;
}

export interface ConnectorInstallOptions {
  /** The plugin's built `dist` directory, holding `extension/` and `bin/native-host.js`. */
  readonly distDir: string;
  /** Where the connector's stable copies live; Chrome keeps loading them from here. */
  readonly dataDir: string;
  readonly socketPath: string;
  /** The Node binary that runs the relay. */
  readonly nodePath: string;
  readonly profiles: readonly ConnectorProfile[];
}

export interface InstalledConnector {
  /** The unpacked extension Chrome loads (chrome://extensions → Load unpacked). */
  readonly extensionDir: string;
}

/**
 * Puts the connector where Chrome can use it, and refreshes it on every start: the
 * plugin's own files move with each installed version, while Chrome needs fixed paths.
 *
 * - `<dataDir>/extension`: the unpacked connector extension;
 * - `<dataDir>/native-host.mjs` and one launcher per profile: the relay;
 * - a native host manifest in each profile's user data directory, which lets only the
 *   connector's extension id start that profile's launcher.
 */
export async function installConnector(
  options: ConnectorInstallOptions,
): Promise<InstalledConnector> {
  const { dataDir } = options;
  await mkdir(dataDir, { recursive: true, mode: 0o700 });

  const extensionDir = join(dataDir, 'extension');
  await replaceDirectory(join(options.distDir, 'extension'), extensionDir);

  // `.mjs`: outside the package, no package.json tells Node that the relay is an ES module.
  const relayPath = join(dataDir, 'native-host.mjs');
  await cp(join(options.distDir, 'bin', 'native-host.js'), relayPath);

  for (const profile of options.profiles) {
    const launcherPath = join(dataDir, `native-host-${profile.name}`);
    await writeFile(
      launcherPath,
      relayLauncher({
        nodePath: options.nodePath,
        relayPath,
        socketPath: options.socketPath,
        profile: profile.name,
      }),
    );
    await chmod(launcherPath, 0o700);

    const manifestDir = join(profile.userDataDir, 'NativeMessagingHosts');
    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, `${NATIVE_HOST_NAME}.json`),
      `${JSON.stringify(nativeHostManifest(launcherPath), null, 2)}\n`,
    );
  }
  return { extensionDir };
}

/** The manifest Chrome reads to start the relay for the connector, and only for it. */
export function nativeHostManifest(launcherPath: string): object {
  return {
    name: NATIVE_HOST_NAME,
    description: 'Relay between the dsh-chrome connector extension and DeepSeek Harness',
    path: launcherPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${CONNECTOR_EXTENSION_ID}/`],
  };
}

export function relayLauncher(options: {
  readonly nodePath: string;
  readonly relayPath: string;
  readonly socketPath: string;
  readonly profile: string;
}): string {
  return [
    '#!/bin/sh',
    '# Written by dsh-chrome on every start. Chrome runs this native messaging host',
    '# for the dsh-chrome connector extension.',
    `DSH_CHROME_CONNECTOR_SOCKET=${shellQuote(options.socketPath)}`,
    `DSH_CHROME_PROFILE=${shellQuote(options.profile)}`,
    'export DSH_CHROME_CONNECTOR_SOCKET DSH_CHROME_PROFILE',
    `exec ${shellQuote(options.nodePath)} ${shellQuote(options.relayPath)}`,
    '',
  ].join('\n');
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * Replaces `target` with a copy of `source`. The copy is staged first, so a failed
 * copy leaves the previous connector in place.
 */
async function replaceDirectory(source: string, target: string): Promise<void> {
  const staged = `${target}.new`;
  await rm(staged, { recursive: true, force: true });
  await cp(source, staged, { recursive: true });
  await rm(target, { recursive: true, force: true });
  await rename(staged, target);
}
