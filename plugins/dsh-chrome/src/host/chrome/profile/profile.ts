import { access, chmod, mkdir, rename, rmdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { shareNativeHosts } from './shared-native-hosts.ts';

export interface ProfileOptions {
  /** The Chrome user data directory of dsh-chrome's profile. */
  readonly profileDir: string;
  /**
   * Where earlier versions kept the profile; one found there moves to `profileDir`, and the
   * directory it was in goes too, if that is left empty.
   */
  readonly earlierProfileDirs: readonly string[];
  /**
   * The user data directory of the user's own Chrome, whose native apps (1Password's
   * desktop app, say) the profile's extensions may reach; `undefined` shares none.
   */
  readonly nativeHostsFrom: string | undefined;
  /** Where the links made for the native apps are recorded. */
  readonly sharingRecordPath: string;
}

/**
 * Readies the profile's directory for Chrome: there, private to this user, and reaching the
 * native apps it should.
 * @returns what could not be done, for the log; the profile is still usable.
 */
export async function prepareProfile(options: ProfileOptions): Promise<string[]> {
  const warnings: string[] = [];
  if (!(await exists(options.profileDir))) {
    for (const earlier of options.earlierProfileDirs) {
      if (!(await exists(earlier))) continue;
      await mkdir(dirname(options.profileDir), { recursive: true, mode: 0o700 });
      try {
        await rename(earlier, options.profileDir);
        await rmdir(dirname(earlier)).catch(() => {});
      } catch (error) {
        warnings.push(`could not move the profile from ${earlier}: ${String(error)}`);
      }
      break;
    }
  }
  await mkdir(options.profileDir, { recursive: true, mode: 0o700 });
  await chmod(options.profileDir, 0o700);
  const hosts = join(options.profileDir, 'NativeMessagingHosts');
  warnings.push(
    ...(await shareNativeHosts(
      options.sharingRecordPath,
      options.nativeHostsFrom === undefined
        ? []
        : [{ from: join(options.nativeHostsFrom, 'NativeMessagingHosts'), to: hosts }],
    )),
  );
  return warnings;
}

function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}
