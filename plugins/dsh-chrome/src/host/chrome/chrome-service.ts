import { join } from 'node:path';
import { type Context, Service } from '@deepseek-ai/cordis';
import type { Log } from '../platform/log.ts';
import { type Display, startDisplay } from './display/display.ts';
import type { ScreenSize } from './display/screen-control.ts';

export type { ScreenSize };

import { HelpRequests } from './help-requests.ts';
import type { ChromePage, PageId, PageOpener, RequestOptions } from './pages/page.ts';
import { PageRegistry } from './pages/page-registry.ts';
import { type ChromeProcess, launchChrome } from './process/launch.ts';
import { removeEarlierVersionFiles } from './profile/earlier-versions.ts';
import { setChromePreferences } from './profile/preferences.ts';
import { prepareProfile } from './profile/profile.ts';

declare module '@deepseek-ai/cordis' {
  interface Context {
    chrome: ChromeService;
  }
}

export interface ChromeServiceConfig {
  readonly chromeExecutable: string;
  readonly xvncExecutable: string;
  readonly windowManagerExecutable: string;
  /** The Chrome user data directory dsh-chrome owns. */
  readonly profileDir: string;
  /** Where earlier versions kept the profile, to move it from. */
  readonly earlierProfileDirs: readonly string[];
  /** The user's own Chrome's user data directory, where native apps register themselves. */
  readonly userChromeDir: string;
  /** Whether the profile's extensions may reach the user's own Chrome's native apps. */
  readonly shareNativeHosts: boolean;
  /** Where dsh-chrome keeps what it records between starts. */
  readonly dataDir: string;
  /** For the VNC socket and the window manager's configuration. */
  readonly runtimeDir: string;
  /** How many device pixels a CSS pixel takes in Chrome. */
  readonly deviceScaleFactor: number;
  /** Whether pages are told that Chrome is under automated control (`navigator.webdriver`). */
  readonly announceAutomation: boolean;
}

/** Whether Chrome runs, for the sidebar. */
export type ChromeState =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'starting' }
  | { readonly kind: 'running'; readonly version: string }
  | { readonly kind: 'failed'; readonly message: string };

/** The screen's size until a viewer gives its own, in device pixels. */
const FIRST_SCREEN_SIZE: ScreenSize = { width: 1280, height: 800 };
/** The smallest and largest side a viewer may give the screen, in device pixels. */
const MIN_SCREEN_SIDE = 200;
const MAX_SCREEN_SIDE = 8192;

/**
 * `ctx.chrome`: the Chrome dsh-chrome runs on a screen of its own, its pages and the DSH
 * sessions they belong to, and the agent's requests for the user's help. The viewer, the
 * tools and the context reading reach Chrome through this service.
 *
 * The screen starts when a viewer first connects, or Chrome first starts, and then stays
 * until the plugin stops, so that viewers stay connected while Chrome is closed and started
 * again. Chrome starts when a viewer asks for it, or a tool needs it, and runs until the user
 * closes its last window or the plugin stops.
 *
 * Cordis calls a service's methods and getters through a proxy of the instance, so its
 * members use TypeScript `private` rather than `#private` fields, which a proxy cannot reach.
 */
export class ChromeService extends Service {
  readonly pages = new PageRegistry();
  readonly helpRequests = new HelpRequests();
  private readonly config: ChromeServiceConfig;
  private readonly log: Log;
  private display: Promise<Display> | undefined;
  private chromeStart: Promise<ChromeProcess> | undefined;
  /** The Chrome that runs, once it does. */
  private runningChrome: ChromeProcess | undefined;
  private current: ChromeState = { kind: 'stopped' };
  private readonly stateListeners = new Set<(state: ChromeState) => void>();
  /** The size the screen should have, for the screen to come when none runs. */
  private screenSize: ScreenSize = FIRST_SCREEN_SIZE;
  /** Set once the plugin stops: nothing may start after its closing. */
  private stopped = false;

  constructor(ctx: Context, config: ChromeServiceConfig) {
    super(ctx, 'chrome');
    this.config = config;
    this.log = {
      info: (message) => ctx.logger.info(message),
      warn: (message) => ctx.logger.warn(message),
    };
  }

  async [Service.init](): Promise<void> {
    const { dataDir, profileDir, userChromeDir } = this.config;
    const warnings = [
      ...(await prepareProfile({
        profileDir,
        earlierProfileDirs: this.config.earlierProfileDirs,
        nativeHostsFrom: this.config.shareNativeHosts ? userChromeDir : undefined,
        sharingRecordPath: join(dataDir, 'shared-native-hosts.json'),
      })),
      ...(await removeEarlierVersionFiles({ dataDir, profileDir, userChromeDir })),
    ];
    for (const warning of warnings) this.log.warn(`dsh-chrome: ${warning}`);
    this.ctx.effect(
      () => () => {
        this.stopped = true;
        return this.stopAll();
      },
      'dsh-chrome: Chrome and its screen',
    );
  }

  get state(): ChromeState {
    return this.current;
  }

  /** Listens to changes of {@link state}. */
  onStateChange(listener: (state: ChromeState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** How many device pixels a CSS pixel takes in Chrome. */
  get deviceScaleFactor(): number {
    return this.config.deviceScaleFactor;
  }

  /** The running Chrome, started now if it is not. */
  chrome(options: RequestOptions = {}): Promise<ChromeProcess> {
    if (this.stopped) return Promise.reject(new Error('dsh-chrome is stopping'));
    this.chromeStart ??= this.startChrome();
    return untilAborted(this.chromeStart, options.signal);
  }

  /** Where VNC viewers connect to the screen, started now if it is not. */
  async vncSocketPath(options: RequestOptions = {}): Promise<string> {
    return (await this.screen(options)).vncSocketPath;
  }

  /**
   * Sizes the screen, in device pixels, kept within bounds; the screen of a later start
   * takes the size too.
   */
  async resizeScreen(size: ScreenSize): Promise<void> {
    this.screenSize = { width: clampSide(size.width), height: clampSide(size.height) };
    const display = await this.display?.catch(() => undefined);
    await display?.resize(this.screenSize);
  }

  /**
   * Opens a page for a session, in a new tab in front, as a person opening a tab would.
   * @returns the page, once Chrome reports it.
   */
  async openPage(
    sessionId: string,
    url: string,
    options: RequestOptions & { readonly openedBy: PageOpener },
  ): Promise<ChromePage> {
    const chrome = await this.chrome(options);
    // Not cut short by the signal: a tab Chrome made unclaimed would be the user's, open to
    // every session.
    const { targetId } = await chrome.connection.send('Target.createTarget', { url });
    this.pages.claim(targetId, sessionId, options.openedBy);
    const page = await this.pages.whenAdopted(targetId, options);
    this.pages.touch(page.id);
    return page;
  }

  page(id: PageId): ChromePage | undefined {
    return this.pages.get(id);
  }

  /** The screen, started now if it is not. */
  private screen(options: RequestOptions = {}): Promise<Display> {
    if (this.stopped) return Promise.reject(new Error('dsh-chrome is stopping'));
    if (this.display === undefined) {
      const starting = startDisplay({
        xvnc: this.config.xvncExecutable,
        windowManager: this.config.windowManagerExecutable,
        runtimeDir: this.config.runtimeDir,
        size: this.screenSize,
      });
      this.display = starting;
      starting.then(
        (display) =>
          display.exited.then(() => {
            if (this.display !== starting) return;
            this.display = undefined;
            this.log.warn('dsh-chrome: the screen Chrome draws on stopped');
          }),
        () => {
          if (this.display === starting) this.display = undefined;
        },
      );
    }
    return untilAborted(this.display, options.signal);
  }

  private async startChrome(): Promise<ChromeProcess> {
    this.setState({ kind: 'starting' });
    try {
      const display = await this.screen();
      const preferencesProblem = await setChromePreferences(this.config.profileDir);
      if (preferencesProblem !== undefined) this.log.warn(`dsh-chrome: ${preferencesProblem}`);
      const chrome = await launchChrome({
        executable: this.config.chromeExecutable,
        profileDir: this.config.profileDir,
        display: display.name,
        authorityPath: display.authorityPath,
        deviceScaleFactor: this.config.deviceScaleFactor,
        announceAutomation: this.config.announceAutomation,
        log: this.log,
      });
      try {
        await this.pages.track(chrome.connection);
        if (this.stopped) throw new Error('dsh-chrome is stopping');
      } catch (error) {
        await chrome.close();
        throw error;
      }
      this.runningChrome = chrome;
      void chrome.exited.then(() => this.chromeExited(chrome));
      this.log.info(`dsh-chrome: ${chrome.version} started on display ${display.name}`);
      this.setState({ kind: 'running', version: chrome.version });
      return chrome;
    } catch (error) {
      this.chromeStart = undefined;
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`dsh-chrome: Chrome did not start: ${message}`);
      this.setState({ kind: 'failed', message });
      throw error;
    }
  }

  private chromeExited(chrome: ChromeProcess): void {
    if (this.runningChrome !== chrome) return;
    this.runningChrome = undefined;
    this.chromeStart = undefined;
    this.log.info('dsh-chrome: Chrome exited');
    this.setState({ kind: 'stopped' });
  }

  private async stopAll(): Promise<void> {
    const chrome = await this.chromeStart?.catch(() => undefined);
    this.chromeStart = undefined;
    this.runningChrome = undefined;
    await chrome?.close();
    const display = await this.display?.catch(() => undefined);
    this.display = undefined;
    await display?.stop();
    this.setState({ kind: 'stopped' });
  }

  private setState(state: ChromeState): void {
    this.current = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }
}

function clampSide(side: number): number {
  return Math.min(MAX_SCREEN_SIDE, Math.max(MIN_SCREEN_SIDE, Math.round(side)));
}

/** The promise, or its signal's reason once it aborts: the caller stops waiting, nothing else. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal === undefined) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}
