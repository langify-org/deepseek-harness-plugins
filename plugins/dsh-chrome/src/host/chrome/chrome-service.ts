import { type Context, Service } from '@deepseek-ai/cordis';
import type { DedicatedChromeState, DedicatedDisplay, PageOpener } from '../../protocol/viewer.ts';
import type { Log } from '../platform/log.ts';
import { PLUGIN_VERSION, packageDistDir } from '../platform/package-files.ts';
import type { ConnectedBrowser, RequestOptions } from './connector/connected-browser.ts';
import { type ConnectorProfile, installConnector } from './connector/install.ts';
import { ConnectorServer } from './connector/server.ts';
import { type DedicatedChrome, launchDedicatedChrome } from './dedicated-chrome/launch.ts';
import { HelpRequests } from './help-requests.ts';
import type { ChromePage, PageId } from './pages/page.ts';
import { PageRegistry } from './pages/page-registry.ts';

declare module '@deepseek-ai/cordis' {
  interface Context {
    chrome: ChromeService;
  }
}

/** The user's own Chrome profile, where the user installs the connector. */
export const DAILY_PROFILE = 'daily';
/** A Chrome profile the plugin owns and starts itself. */
export const DEDICATED_PROFILE = 'dedicated';
export type ProfileName = typeof DAILY_PROFILE | typeof DEDICATED_PROFILE;

export interface ChromeServiceConfig {
  readonly dailyProfile: { readonly enabled: boolean; readonly userDataDir: string };
  readonly dedicatedProfile: {
    readonly enabled: boolean;
    readonly executable: string;
    readonly userDataDir: string;
    /** Where its windows go when it starts; the user can show them for a while to set it up. */
    readonly display: DedicatedDisplay;
    /** Whether its extensions may reach the native apps the daily profile's reach. */
    readonly shareNativeHosts: boolean;
  };
  /** The profile pages open in unless a request names one. */
  readonly defaultProfile: ProfileName;
  /** Where the connector's files are kept for Chrome to load. */
  readonly dataDir: string;
  readonly connectorSocketPath: string;
  /** The Node.js that Chrome runs the connector's relay with. */
  readonly nodeExecutable: string;
}

/** How long a started dedicated Chrome may take before its connector says hello. */
const DEDICATED_CONNECT_TIMEOUT_MS = 30_000;

const DEDICATED_TURNED_OFF =
  'the dedicated Chrome profile is turned off in the dsh-chrome settings (dedicatedProfile.enabled)';

/** Raised when no connected browser can serve a request; the message says how to connect one. */
export class NoBrowserError extends Error {
  readonly profile: string;

  constructor(profile: string, message: string) {
    super(message);
    this.name = 'NoBrowserError';
    this.profile = profile;
  }
}

/**
 * `ctx.chrome`: the browsers connected through the connector, the pages the plugin
 * controls in them, and the agent's requests for the user's help. The viewer, the tools
 * and the context reading all reach Chrome through this service.
 *
 * Cordis calls a service's methods and getters through a proxy of the instance, so its
 * members use TypeScript `private` rather than `#private` fields, which a proxy cannot reach.
 */
export class ChromeService extends Service {
  readonly pages = new PageRegistry();
  readonly helpRequests = new HelpRequests();
  private readonly config: ChromeServiceConfig;
  private readonly log: Log;
  private readonly connectedBrowsers: ConnectedBrowser[] = [];
  private readonly browserListeners = new Set<(browser: ConnectedBrowser) => void>();
  private installedExtensionDir: string | undefined;
  /** The dedicated profile's Chrome, from its start until it exits. */
  private dedicatedChrome: Promise<DedicatedChrome> | undefined;
  /** The dedicated Chrome's connector, while it is connected. */
  private dedicatedBrowser: ConnectedBrowser | undefined;
  /** Where the dedicated Chrome shows its windows, now. */
  private dedicatedDisplay: DedicatedDisplay;
  private readonly dedicatedListeners = new Set<(state: DedicatedChromeState) => void>();

  constructor(ctx: Context, config: ChromeServiceConfig) {
    super(ctx, 'chrome');
    this.config = config;
    this.dedicatedDisplay = config.dedicatedProfile.display;
    this.log = {
      info: (message) => ctx.logger.info(message),
      warn: (message) => ctx.logger.warn(message),
    };
  }

  async [Service.init](): Promise<void> {
    const daily: ConnectorProfile = {
      name: DAILY_PROFILE,
      userDataDir: this.config.dailyProfile.userDataDir,
    };
    const dedicated: ConnectorProfile = {
      name: DEDICATED_PROFILE,
      userDataDir: this.config.dedicatedProfile.userDataDir,
      ...(this.config.dedicatedProfile.shareNativeHosts
        ? { nativeHostsFrom: this.config.dailyProfile.userDataDir }
        : {}),
    };
    const profiles = [daily, dedicated];
    const installed = await installConnector({
      distDir: packageDistDir(),
      dataDir: this.config.dataDir,
      socketPath: this.config.connectorSocketPath,
      nodePath: this.config.nodeExecutable,
      profiles: profiles.filter((profile) => this.isEnabled(profile.name)),
      retiredProfiles: profiles.filter((profile) => !this.isEnabled(profile.name)),
    });
    this.installedExtensionDir = installed.extensionDir;

    const server = await ConnectorServer.listen({
      socketPath: this.config.connectorSocketPath,
      connectorVersion: PLUGIN_VERSION,
      onBrowser: (browser) => this.connect(browser),
      // Only the dedicated Chrome on its virtual display is out of everyone's sight.
      visibleWindows: (profile) =>
        !(profile === DEDICATED_PROFILE && this.dedicatedDisplay === 'virtual'),
      log: this.log,
    });
    this.ctx.effect(() => () => server.close(), 'dsh-chrome: connector server');
    this.ctx.effect(() => () => this.closeDedicated(), 'dsh-chrome: dedicated Chrome');
    this.log.info(
      `dsh-chrome: waiting for Chrome; its connector is ${installed.extensionDir} ` +
        '(chrome://extensions, Developer mode, "Load unpacked")',
    );
  }

  /** The unpacked connector extension, for the user to load into Chrome. */
  get extensionDir(): string | undefined {
    return this.installedExtensionDir;
  }

  /** The dedicated Chrome: whether it runs, and where its windows are. */
  get dedicated(): DedicatedChromeState {
    const state = !this.config.dedicatedProfile.enabled
      ? 'off'
      : this.dedicatedChrome === undefined
        ? 'stopped'
        : this.dedicatedBrowser === undefined
          ? 'starting'
          : 'running';
    return { state, display: this.dedicatedDisplay };
  }

  /** Listens to changes of {@link dedicated}. */
  onDedicatedChange(listener: (state: DedicatedChromeState) => void): () => void {
    this.dedicatedListeners.add(listener);
    return () => this.dedicatedListeners.delete(listener);
  }

  /**
   * Moves the dedicated Chrome's windows to a display: onto the desktop, so the user can set
   * the profile up (sign in to Chrome, add extensions), or back out of sight. Chrome cannot
   * move its windows between displays, so a running one starts again there, and its pages
   * close. On the desktop it starts at once, for the user to see.
   */
  async setDedicatedDisplay(display: DedicatedDisplay): Promise<void> {
    if (!this.config.dedicatedProfile.enabled) {
      throw new NoBrowserError(DEDICATED_PROFILE, DEDICATED_TURNED_OFF);
    }
    if (display === this.dedicatedDisplay) return;
    const wasRunning = this.dedicatedChrome !== undefined;
    this.dedicatedDisplay = display;
    this.notifyDedicated();
    await this.closeDedicated();
    if (wasRunning || display === 'desktop') await this.startDedicated(undefined);
  }

  /** Connected browsers, most recently connected first. */
  get browsers(): readonly ConnectedBrowser[] {
    return [...this.connectedBrowsers].reverse();
  }

  /** The most recently connected browser of a profile. */
  browserFor(profile: string): ConnectedBrowser | undefined {
    return this.browsers.find((browser) => browser.identity.profile === profile);
  }

  /**
   * Opens a page for a session, in the named profile or the default one. The dedicated
   * profile's Chrome is started on first use.
   * @throws NoBrowserError when that profile cannot be reached.
   */
  async openPage(
    sessionId: string,
    url: string,
    options: RequestOptions & {
      readonly profile?: ProfileName | undefined;
      readonly openedBy: PageOpener;
    },
  ): Promise<ChromePage> {
    const browser = await this.browserForOpening(
      options.profile ?? this.config.defaultProfile,
      options.signal,
    );
    const snapshot = await browser.openPage(
      url,
      { key: sessionId, title: groupTitle(sessionId) },
      options,
    );
    return this.pages.adopt(sessionId, browser, snapshot, { openedBy: options.openedBy });
  }

  page(id: PageId): ChromePage | undefined {
    return this.pages.get(id);
  }

  /** The session's pages, most recently used first. */
  pagesOf(sessionId: string): ChromePage[] {
    return this.pages.ofSession(sessionId);
  }

  private async browserForOpening(
    profile: ProfileName,
    signal: AbortSignal | undefined,
  ): Promise<ConnectedBrowser> {
    const connected = this.browserFor(profile);
    if (connected !== undefined) return connected;
    if (profile === DEDICATED_PROFILE) return this.startDedicated(signal);
    if (!this.config.dailyProfile.enabled) {
      throw new NoBrowserError(
        profile,
        'your own Chrome profile is turned off in the dsh-chrome settings (dailyProfile.enabled)',
      );
    }
    throw new NoBrowserError(
      profile,
      'your Chrome is not connected. Keep Chrome running with the dsh-chrome connector installed: ' +
        'open chrome://extensions, turn on Developer mode, choose "Load unpacked", and select ' +
        `${this.installedExtensionDir ?? 'the connector directory'}`,
    );
  }

  /**
   * The dedicated profile's browser: its Chrome is started if it is not running, and its
   * connector is awaited. A Chrome whose connector does not connect in time is closed, so
   * that the next attempt starts afresh rather than handing off to it.
   */
  private async startDedicated(signal: AbortSignal | undefined): Promise<ConnectedBrowser> {
    if (!this.config.dedicatedProfile.enabled) {
      throw new NoBrowserError(DEDICATED_PROFILE, DEDICATED_TURNED_OFF);
    }
    const extensionDir = this.installedExtensionDir;
    if (extensionDir === undefined) {
      throw new NoBrowserError(DEDICATED_PROFILE, 'dsh-chrome is still starting');
    }
    // Listening first: the connector may connect before Chrome's start is reported.
    const connected = this.nextBrowser(DEDICATED_PROFILE, DEDICATED_CONNECT_TIMEOUT_MS, signal);
    const starting = this.dedicatedChromeFor(extensionDir);
    try {
      await starting;
    } catch (error) {
      connected.cancel();
      throw error;
    }
    try {
      return await connected.browser;
    } catch (error) {
      // A stopped caller leaves Chrome to the others; a connector that never came does not.
      if (!(signal?.aborted ?? false)) await this.closeDedicated(starting);
      throw error;
    }
  }

  /** The running dedicated Chrome, started once however many pages wait for it. */
  private dedicatedChromeFor(extensionDir: string): Promise<DedicatedChrome> {
    if (this.dedicatedChrome !== undefined) return this.dedicatedChrome;
    const { executable, userDataDir } = this.config.dedicatedProfile;
    const starting = launchDedicatedChrome({
      executable,
      userDataDir,
      extensionDir,
      display: this.dedicatedDisplay,
      log: this.log,
    });
    this.dedicatedChrome = starting;
    this.notifyDedicated();
    const forget = () => {
      if (this.dedicatedChrome !== starting) return;
      this.dedicatedChrome = undefined;
      // A window shown for setting up is closed once the user is done with it: the
      // configured display applies again.
      this.dedicatedDisplay = this.config.dedicatedProfile.display;
      this.notifyDedicated();
    };
    starting.then(
      (chrome) =>
        chrome.exited.then(() => {
          forget();
          this.log.info('dsh-chrome: the dedicated Chrome exited');
        }),
      forget,
    );
    return starting;
  }

  private notifyDedicated(): void {
    const state = this.dedicated;
    for (const listener of [...this.dedicatedListeners]) listener(state);
  }

  private isEnabled(profile: string): boolean {
    if (profile === DAILY_PROFILE) return this.config.dailyProfile.enabled;
    if (profile === DEDICATED_PROFILE) return this.config.dedicatedProfile.enabled;
    return false;
  }

  /**
   * Closes the dedicated Chrome, or, given a start, only the Chrome of that start: a caller
   * that waited for one Chrome must not close a later one.
   */
  private async closeDedicated(start?: Promise<DedicatedChrome>): Promise<void> {
    const starting = this.dedicatedChrome;
    if (starting === undefined || (start !== undefined && start !== starting)) return;
    this.dedicatedChrome = undefined;
    this.notifyDedicated();
    const chrome = await starting.catch(() => undefined);
    await chrome?.close();
  }

  /** Resolves with the next browser of the profile to connect. */
  private nextBrowser(
    profile: string,
    timeoutMs: number,
    signal: AbortSignal | undefined,
  ): { readonly browser: Promise<ConnectedBrowser>; cancel(): void } {
    let cancel = () => {};
    const browser = new Promise<ConnectedBrowser>((resolve, reject) => {
      const listener = (browser: ConnectedBrowser) => {
        if (browser.identity.profile !== profile) return;
        cancel();
        resolve(browser);
      };
      const timer = setTimeout(() => {
        cancel();
        reject(new NoBrowserError(profile, `the ${profile} Chrome did not connect in time`));
      }, timeoutMs);
      const abort = () => {
        cancel();
        reject(signal?.reason);
      };
      cancel = () => {
        clearTimeout(timer);
        this.browserListeners.delete(listener);
        signal?.removeEventListener('abort', abort);
      };
      this.browserListeners.add(listener);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    // It may fail while its caller still waits for Chrome to start; DSH ends on an
    // unhandled rejection.
    browser.catch(() => {});
    return { browser, cancel: () => cancel() };
  }

  private connect(browser: ConnectedBrowser): void {
    const { label, profile, extensionVersion } = browser.identity;
    if (!this.isEnabled(profile)) {
      // A connector loaded in a profile that is turned off, reaching an older launcher.
      this.log.warn(`dsh-chrome: turned away ${label}: the ${profile} profile is turned off`);
      browser.disconnect();
      return;
    }
    this.log.info(
      `dsh-chrome: ${label} connected (${profile} profile, connector ${extensionVersion})`,
    );
    this.connectedBrowsers.push(browser);
    if (profile === DEDICATED_PROFILE) {
      this.dedicatedBrowser = browser;
      this.notifyDedicated();
    }
    browser.onClose(() => {
      this.connectedBrowsers.splice(this.connectedBrowsers.indexOf(browser), 1);
      this.log.info(`dsh-chrome: ${label} disconnected`);
      if (this.dedicatedBrowser === browser) {
        this.dedicatedBrowser = undefined;
        this.notifyDedicated();
      }
    });
    this.pages.track(browser);
    for (const listener of [...this.browserListeners]) listener(browser);
    // A connector that outlived the host still controls the pages it opened before.
    browser
      .listPages()
      .then((pages) => {
        for (const page of pages) this.pages.adopt(page.groupKey, browser, page);
      })
      .catch((error: unknown) =>
        this.log.warn(`dsh-chrome: could not list pages: ${String(error)}`),
      );
  }
}

/** The Chrome tab group title for a session's pages. */
function groupTitle(sessionId: string): string {
  return `DSH ${sessionId.slice(0, 8)}`;
}
