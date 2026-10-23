import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { type Context, Service } from '@deepseek-ai/cordis';
import type { Protocol } from 'devtools-protocol';
import type { Log } from '../platform/log.ts';
import type { CdpConnection } from './cdp/cdp-connection.ts';
import { type Display, startDisplay } from './display/display.ts';
import type { Monitor, ScreenSize } from './display/screen-control.ts';
import { XConnection } from './display/x-connection.ts';
import { HelpRequests } from './help-requests.ts';
import type { ChromePage, PageId, PageOpener, RequestOptions } from './pages/page.ts';
import { PageRegistry } from './pages/page-registry.ts';
import { type ChromeProcess, launchChrome, type WebglMode } from './process/launch.ts';
import { removeEarlierVersionFiles } from './profile/earlier-versions.ts';
import { setChromePreferences } from './profile/preferences.ts';
import { prepareProfile } from './profile/profile.ts';
import {
  readUserChrome,
  removeUnfinishedCopy,
  stageProfileCopy,
  type UserChrome,
} from './profile/profile-copy.ts';
import { KeyboardFocus } from './sessions/keyboard-focus.ts';
import { SessionScreens } from './sessions/session-screens.ts';

export { WEBGL_MODES, type WebglMode } from './process/launch.ts';
export type { KeyboardFocus } from './sessions/keyboard-focus.ts';
export type { Monitor, ScreenSize, UserChrome };

declare module '@deepseek-ai/cordis' {
  interface Context {
    chrome: ChromeService;
  }
}

/** What the user sets in the plugin's settings; Chrome takes them when it starts. */
export interface ChromeSettings {
  readonly executable: string;
  /** How many device pixels a CSS pixel takes in Chrome. */
  readonly deviceScaleFactor: number;
  /** Whether pages are told that Chrome is under automated control (`navigator.webdriver`). */
  readonly announceAutomation: boolean;
  readonly webgl: WebglMode;
  /** Whether the profile's extensions may reach the user's own Chrome's native apps. */
  readonly shareNativeHosts: boolean;
}

export interface ChromeServiceConfig {
  readonly xvncExecutable: string;
  readonly windowManagerExecutable: string;
  /** The Chrome user data directory dsh-chrome owns. */
  readonly profileDir: string;
  /** Where earlier versions kept the profile, to move it from. */
  readonly earlierProfileDirs: readonly string[];
  /** The user's own Chrome's user data directory, where native apps register themselves. */
  readonly userChromeDir: string;
  /** Where dsh-chrome keeps what it records between starts. */
  readonly dataDir: string;
  /** For the VNC socket and the window manager's configuration. */
  readonly runtimeDir: string;
  /** The user's settings as they are now. */
  readonly settings: () => ChromeSettings;
  /** Listens to the settings changing; returns the function that stops listening. */
  readonly onSettingsChange: (listener: () => void) => () => void;
}

/** A window's place, as Chrome measures it: in CSS pixels of its screen. */
type WindowBounds = Protocol.Browser.Bounds;

/** Whether Chrome runs, for the sidebar. */
export type ChromeState =
  | { readonly kind: 'stopped' }
  | { readonly kind: 'starting' }
  | {
      readonly kind: 'running';
      readonly version: string;
      /** The settings changed since Chrome started: they apply once it starts again. */
      readonly settingsChanged: boolean;
    }
  | { readonly kind: 'failed'; readonly message: string };

/** The size of a session's screen until its view gives one, in CSS pixels of Chrome. */
const SESSION_SCREEN_CSS: ScreenSize = { width: 1280, height: 800 };
/** The address of the page a window the user opens shows first. */
const NEW_TAB_URL = 'chrome://newtab/';
/**
 * When, after a change of the screen's layout, the sessions' windows are checked for their
 * places: the window manager places them anew some time after the change.
 */
const PLACEMENT_CHECKS_MS = [150, 600];
/** Where a window that is not maximized (a popup) goes on its session's part of the screen. */
const POPUP_OFFSET_CSS = 24;
/** How long after the X connection closed, or could not open, it is opened again. */
const X_RETRY_MS = 2000;
/** The page a target opens at, before it goes to its address once it is in its place. */
const BLANK_URL = 'about:blank';

/**
 * `ctx.chrome`: the Chrome dsh-chrome runs on a screen of its own, its pages and the DSH
 * sessions they belong to, and the agent's requests for the user's help. The viewer, the
 * tools and the context reading reach Chrome through this service.
 *
 * Each DSH session that uses Chrome has its own part of the screen, its session screen (a
 * monitor, as Chrome sees it), and its own windows there: its view in the sidebar shows that
 * part only, and its agent's pages open there. A page belongs to the session whose screen its
 * window is on.
 *
 * The screen starts when a viewer first connects, or Chrome first starts, and then stays
 * until the plugin stops, so that viewers stay connected while Chrome is closed and started
 * again. Chrome starts when a session opens a window, and runs until the plugin stops or the
 * user quits it: it opens no window of its own.
 *
 * Cordis calls a service's methods and getters through a proxy of the instance, so its
 * members use TypeScript `private` rather than `#private` fields, which a proxy cannot reach.
 */
export class ChromeService extends Service {
  readonly pages = new PageRegistry((targetId) => this.sessionOfTarget(targetId));
  readonly helpRequests = new HelpRequests();
  /** The part of the screen each session has. */
  readonly screens: SessionScreens;
  /** Which session's windows the user's keys go to. */
  readonly keyboard: KeyboardFocus;
  private readonly config: ChromeServiceConfig;
  private readonly log: Log;
  private display: Promise<Display> | undefined;
  /** The host's own connection to the screen's X server, while one is open. */
  private x: XConnection | undefined;
  /** The screen that runs, once it has started. */
  private runningDisplay: Display | undefined;
  private xRetry: ReturnType<typeof setTimeout> | undefined;
  private chromeStart: Promise<ChromeProcess> | undefined;
  /** The Chrome that runs, once it does, and the settings it started with. */
  private runningChrome: { process: ChromeProcess; settings: ChromeSettings } | undefined;
  /** The CDP connection of the Chrome that starts or runs. */
  private connection: CdpConnection | undefined;
  private current: ChromeState = { kind: 'stopped' };
  private readonly stateListeners = new Set<(state: ChromeState) => void>();
  /** How many viewers show each session's screen. */
  private readonly viewers = new Map<string, number>();
  /** How many of each session's pages are being opened. */
  private readonly openings = new Map<string, number>();
  /** Openings of tabs in a session's window, one at a time: each takes Chrome's focus. */
  private openingQueue: Promise<unknown> = Promise.resolve();
  /** The placing of the sessions' windows after a change of layout, one at a time. */
  private placing: Promise<void> = Promise.resolve();
  private placementWanted = false;
  /** Chrome starts once this settles: a copy of a profile taking the place of dsh-chrome's. */
  private profileChange: Promise<void> = Promise.resolve();
  private copying = false;
  /** Stops a profile copy when the plugin stops. */
  private readonly copyAbort = new AbortController();
  /** Set once the plugin stops: nothing may start after its closing. */
  private stopped = false;

  constructor(ctx: Context, config: ChromeServiceConfig) {
    super(ctx, 'chrome');
    this.config = config;
    this.log = {
      info: (message) => ctx.logger.info(message),
      warn: (message) => ctx.logger.warn(message),
    };
    this.screens = new SessionScreens(
      () => ({
        width: SESSION_SCREEN_CSS.width * this.deviceScaleFactor,
        height: SESSION_SCREEN_CSS.height * this.deviceScaleFactor,
      }),
      this.log,
    );
    this.keyboard = new KeyboardFocus({
      xConnection: () => this.x,
      sessionAt: (x, y) => this.screens.sessionAt(x, y),
      activate: (sessionId) => this.activateSession(sessionId),
      log: this.log,
    });
  }

  async [Service.init](): Promise<void> {
    const { dataDir, profileDir, userChromeDir } = this.config;
    // The profile moves from where an earlier version kept it before what that version left
    // in it is removed.
    const warnings = [
      ...(await this.prepareProfile()),
      ...(await removeEarlierVersionFiles({ dataDir, profileDir, userChromeDir })),
    ];
    for (const warning of warnings) this.log.warn(`dsh-chrome: ${warning}`);
    await removeUnfinishedCopy(profileDir);
    this.ctx.effect(
      () => this.pages.onChange(() => this.reviewScreens()),
      'dsh-chrome: session screens',
    );
    this.ctx.effect(
      () => this.screens.onChange(() => this.placeWindows()),
      "dsh-chrome: the sessions' windows on their screens",
    );
    this.ctx.effect(
      () => this.config.onSettingsChange(() => this.settingsChanged()),
      'dsh-chrome: the settings Chrome runs with',
    );
    this.ctx.effect(
      () => () => {
        this.stopped = true;
        this.copyAbort.abort(new Error('dsh-chrome is stopping'));
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

  /** How many device pixels a CSS pixel takes in Chrome: the running one's, else the setting. */
  get deviceScaleFactor(): number {
    return (this.runningChrome?.settings ?? this.config.settings()).deviceScaleFactor;
  }

  /** The settings changed: the sidebar says so while Chrome runs with the earlier ones. */
  private settingsChanged(): void {
    const running = this.runningChrome;
    if (running === undefined || this.current.kind !== 'running') return;
    this.setState({
      ...this.current,
      settingsChanged: !sameSettings(running.settings, this.config.settings()),
    });
  }

  /** The running Chrome, started now if it is not. */
  chrome(options: RequestOptions = {}): Promise<ChromeProcess> {
    if (this.stopped) return Promise.reject(new Error('dsh-chrome is stopping'));
    this.chromeStart ??= this.profileChange.then(() => this.startChrome());
    return untilAborted(this.chromeStart, options.signal);
  }

  /** The profiles of the user's own Chrome, to copy one into dsh-chrome's. */
  userChrome(): Promise<UserChrome> {
    return readUserChrome(this.config.userChromeDir);
  }

  /**
   * Replaces dsh-chrome's profile with a copy of one of the user's own Chrome: the copy is
   * made while Chrome runs, which then closes, every window with it, for the copy to take
   * the profile's place. The profile it replaces is kept beside it until the next copy.
   * @param directory - the profile's directory in the user's Chrome, as {@link userChrome} lists it.
   */
  async copyUserChromeProfile(directory: string): Promise<void> {
    if (this.copying) throw new Error('a profile is being copied already');
    this.copying = true;
    try {
      const staged = await stageProfileCopy({
        userChromeDir: this.config.userChromeDir,
        directory,
        profileDir: this.config.profileDir,
        signal: this.copyAbort.signal,
      });
      const change = (async () => {
        await this.stopChrome();
        // A plugin that stops meanwhile leaves the profile to the one that starts after it.
        this.copyAbort.signal.throwIfAborted();
        await staged.install();
      })();
      this.profileChange = change.catch(() => {});
      try {
        await change;
      } catch (error) {
        await staged.discard();
        throw error;
      }
      this.log.info(
        `dsh-chrome: dsh-chrome's profile is now a copy of your Chrome's "${directory}"`,
      );
    } finally {
      this.copying = false;
    }
  }

  /** Closes Chrome, and starts it again with the settings as they are now. */
  async restartChrome(): Promise<void> {
    await this.stopChrome();
    await this.chrome();
  }

  /**
   * Closes Chrome, if it runs, and returns once it has exited: its windows close, and each
   * session's view offers to open a window again.
   */
  async stopChrome(): Promise<void> {
    const chrome = await this.chromeStart?.catch(() => undefined);
    await chrome?.close();
    await chrome?.exited;
  }

  /** Where VNC viewers connect to the screen, started now if it is not. */
  async vncSocketPath(options: RequestOptions = {}): Promise<string> {
    return (await this.screen(options)).vncSocketPath;
  }

  /**
   * A viewer shows the session's screen: the session keeps a screen while one does.
   * @returns the function to call once the viewer no longer shows it.
   * @throws when the screen has no room for another session.
   */
  showSession(sessionId: string): () => void {
    this.screens.ensure(sessionId);
    this.viewers.set(sessionId, (this.viewers.get(sessionId) ?? 0) + 1);
    // Its windows leave the parking monitor, which may no longer be wanted.
    this.reviewScreens();
    void this.screen().catch(() => {});
    let shown = true;
    return () => {
      if (!shown) return;
      shown = false;
      const left = (this.viewers.get(sessionId) ?? 1) - 1;
      if (left > 0) this.viewers.set(sessionId, left);
      else this.viewers.delete(sessionId);
      this.reviewScreens();
    };
  }

  /**
   * Sizes the session's screen, in device pixels, kept within bounds.
   * @throws when the screen has no room for it.
   */
  sizeSessionScreen(sessionId: string, size: ScreenSize): void {
    this.screens.set(sessionId, size);
  }

  /**
   * Opens a page for a session, in front in the session's window, as a person opening a tab
   * would; in a new window on the session's screen while it has none. The page opens blank,
   * and goes to its address once it is in its place.
   * @returns the page, once Chrome reports it.
   */
  async openPage(
    sessionId: string,
    url: string,
    options: RequestOptions & { readonly openedBy: PageOpener },
  ): Promise<ChromePage> {
    this.openings.set(sessionId, (this.openings.get(sessionId) ?? 0) + 1);
    try {
      const chrome = await this.chrome(options);
      // A session that no view shows opens its windows on the parking monitor.
      this.reviewScreens();
      await this.screen(options);
      await untilAborted(this.screens.settled(), options.signal);
      // Not cut short by the signal: a page Chrome made unclaimed would be another session's.
      const opening = this.openingQueue.then(async () => {
        // Chrome reports the target before it answers; the claim says whose the page is.
        const placed = this.pages.holdPlacement();
        try {
          const targetId = await this.openTarget(chrome.connection, sessionId);
          this.pages.claim(targetId, sessionId, options.openedBy);
          return targetId;
        } finally {
          placed();
        }
      });
      this.openingQueue = opening.catch(() => {});
      const targetId = await opening;
      const page = await this.pages.whenAdopted(targetId, options);
      if (url !== BLANK_URL) await page.send('Page.navigate', { url }, options);
      this.pages.touch(page.id);
      return page;
    } finally {
      const left = (this.openings.get(sessionId) ?? 1) - 1;
      if (left > 0) this.openings.set(sessionId, left);
      else this.openings.delete(sessionId);
      this.reviewScreens();
    }
  }

  /**
   * Shows the session's window, opening one with Chrome's new tab page if it has none:
   * what the user asks for when the session's view opens.
   */
  async openWindow(sessionId: string, options: RequestOptions = {}): Promise<void> {
    await this.chrome(options);
    const front = this.pages.ofSession(sessionId)[0];
    if (front !== undefined) {
      await front.show();
      return;
    }
    await this.openPage(sessionId, NEW_TAB_URL, { ...options, openedBy: 'user' });
  }

  page(id: PageId): ChromePage | undefined {
    return this.pages.get(id);
  }

  /** The screen, started now if it is not. */
  private screen(options: RequestOptions = {}): Promise<Display> {
    if (this.stopped) return Promise.reject(new Error('dsh-chrome is stopping'));
    if (this.display === undefined) {
      const starting = this.startScreen();
      this.display = starting;
      starting.then(
        (display) =>
          display.exited.then(() => {
            if (this.display !== starting) return;
            this.display = undefined;
            this.screenStopped();
            this.log.warn('dsh-chrome: the screen Chrome draws on stopped');
          }),
        () => {
          if (this.display === starting) this.display = undefined;
        },
      );
    }
    return untilAborted(this.display, options.signal);
  }

  private async startScreen(): Promise<Display> {
    const { width, height } = this.screens.layout;
    const display = await startDisplay({
      xvnc: this.config.xvncExecutable,
      windowManager: this.config.windowManagerExecutable,
      runtimeDir: this.config.runtimeDir,
      size: { width, height },
    });
    this.runningDisplay = display;
    await this.connectX(display);
    this.screens.attach((layout) => display.setLayout(layout));
    return display;
  }

  /**
   * Opens the host's own X connection to the screen, and opens it again while the screen runs
   * whenever it closes or does not open: without it, keys go wherever the focus is.
   */
  private async connectX(display: Display): Promise<void> {
    let x: XConnection;
    try {
      x = await XConnection.connect(display.name, display.authorityPath);
    } catch (error) {
      this.log.warn(`dsh-chrome: could not connect to the screen's X server: ${String(error)}`);
      this.retryX(display);
      return;
    }
    if (this.runningDisplay !== display) {
      x.close();
      return;
    }
    this.x = x;
    x.onClose((error) => {
      if (this.x !== x) return;
      this.x = undefined;
      this.keyboard.reset();
      this.log.warn(`dsh-chrome: the connection to the screen's X server closed: ${error.message}`);
      this.retryX(display);
    });
  }

  private retryX(display: Display): void {
    if (this.runningDisplay !== display) return;
    clearTimeout(this.xRetry);
    this.xRetry = setTimeout(() => void this.connectX(display), X_RETRY_MS);
    this.xRetry.unref();
  }

  private screenStopped(): void {
    this.screens.detach();
    this.runningDisplay = undefined;
    clearTimeout(this.xRetry);
    const x = this.x;
    this.x = undefined;
    x?.close();
    this.keyboard.reset();
  }

  private async startChrome(): Promise<ChromeProcess> {
    this.setState({ kind: 'starting' });
    try {
      const settings = this.config.settings();
      const display = await this.screen();
      const { profileDir } = this.config;
      // Again, for the native apps as the settings say now.
      for (const warning of await this.prepareProfile(settings)) {
        this.log.warn(`dsh-chrome: ${warning}`);
      }
      const preferencesProblem = await setChromePreferences(profileDir);
      if (preferencesProblem !== undefined) this.log.warn(`dsh-chrome: ${preferencesProblem}`);
      const chrome = await launchChrome({
        executable: settings.executable,
        profileDir,
        display: display.name,
        authorityPath: display.authorityPath,
        deviceScaleFactor: settings.deviceScaleFactor,
        announceAutomation: settings.announceAutomation,
        webgl: settings.webgl,
        log: this.log,
      });
      this.connection = chrome.connection;
      try {
        await this.pages.track(chrome.connection);
        if (this.stopped) throw new Error('dsh-chrome is stopping');
      } catch (error) {
        await chrome.close();
        throw error;
      }
      this.runningChrome = { process: chrome, settings };
      void chrome.exited.then(() => this.chromeExited(chrome));
      this.log.info(`dsh-chrome: ${chrome.version} started on display ${display.name}`);
      this.setState({
        kind: 'running',
        version: chrome.version,
        // The settings may have changed while Chrome started.
        settingsChanged: !sameSettings(settings, this.config.settings()),
      });
      return chrome;
    } catch (error) {
      this.chromeStart = undefined;
      this.connection = undefined;
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`dsh-chrome: Chrome did not start: ${message}`);
      this.setState({ kind: 'failed', message });
      throw error;
    }
  }

  /**
   * Readies the profile's directory: moved from where an earlier version kept it, private to
   * the user, and reaching the native apps the settings share.
   */
  private prepareProfile(settings = this.config.settings()): Promise<string[]> {
    const { dataDir, profileDir, userChromeDir, earlierProfileDirs } = this.config;
    return prepareProfile({
      profileDir,
      earlierProfileDirs,
      nativeHostsFrom: settings.shareNativeHosts ? userChromeDir : undefined,
      sharingRecordPath: join(dataDir, 'shared-native-hosts.json'),
    });
  }

  private chromeExited(chrome: ChromeProcess): void {
    if (this.runningChrome?.process !== chrome) return;
    this.runningChrome = undefined;
    this.chromeStart = undefined;
    this.connection = undefined;
    this.log.info('dsh-chrome: Chrome exited');
    this.setState({ kind: 'stopped' });
  }

  /**
   * Opens a blank target for the session: a tab in the session's front window, or a window on
   * its screen (its own, or the parking monitor while no view shows it). Chrome opens a tab in
   * the window it last had the focus in, so the session's window gets it first; should another
   * take it meanwhile, the tab goes, and a window opens instead.
   */
  private async openTarget(connection: CdpConnection, sessionId: string): Promise<string> {
    const front = (await this.pages.pageInFront(sessionId)) ?? this.pages.ofSession(sessionId)[0];
    if (front !== undefined) {
      await front.bringToFront();
      const { targetId } = await connection.send('Target.createTarget', { url: BLANK_URL });
      if (await this.sameWindow(connection, targetId, front.targetId)) return targetId;
      await connection.send('Target.closeTarget', { targetId }).catch(() => {});
    }
    const monitor = this.monitorFor(sessionId);
    if (monitor === undefined) throw new Error("the session's screen is not ready");
    // The window manager makes the window fill the monitor it is on.
    const { targetId } = await connection.send('Target.createTarget', {
      url: BLANK_URL,
      newWindow: true,
      focus: false,
      ...this.dipBounds(monitor),
    });
    // Chrome may not know of a monitor just added yet, and put the window on another.
    const { windowId } = await connection.send('Browser.getWindowForTarget', { targetId });
    const { bounds } = await connection.send('Browser.getWindowBounds', { windowId });
    if (!this.isOn(bounds, monitor)) await this.moveWindow(connection, windowId, monitor, true);
    return targetId;
  }

  private async sameWindow(connection: CdpConnection, a: string, b: string): Promise<boolean> {
    const [first, second] = await Promise.all([
      connection.send('Browser.getWindowForTarget', { targetId: a }),
      connection.send('Browser.getWindowForTarget', { targetId: b }),
    ]);
    return first.windowId === second.windowId;
  }

  /** Whose screen the window of a page is on. */
  private async sessionOfTarget(targetId: string): Promise<string | undefined> {
    const connection = this.connection;
    if (connection === undefined) return undefined;
    const { windowId } = await connection.send('Browser.getWindowForTarget', { targetId });
    const { bounds } = await connection.send('Browser.getWindowBounds', { windowId });
    const factor = this.deviceScaleFactor;
    const middle = (start = 0, length = 0) => Math.floor((start + length / 2) * factor);
    return this.screens.sessionAt(
      middle(bounds.left, bounds.width),
      middle(bounds.top, bounds.height),
    );
  }

  /** A monitor's bounds as Chrome measures windows: in CSS pixels of its screen. */
  private dipBounds(monitor: Monitor) {
    const factor = this.deviceScaleFactor;
    return {
      left: Math.round(monitor.x / factor),
      top: Math.round(monitor.y / factor),
      width: Math.floor(monitor.width / factor),
      height: Math.floor(monitor.height / factor),
    };
  }

  /**
   * Puts each session's windows back on its part of the screen after a change of layout: the
   * window manager places a window on the monitor it overlaps most, which, as monitors grow,
   * shrink and move, can be another session's. A maximized window fills its session's part
   * again; a popup goes to its top left corner.
   */
  private placeWindows(): void {
    if (this.placementWanted) return;
    this.placementWanted = true;
    this.placing = this.placing.then(async () => {
      this.placementWanted = false;
      for (const delay of PLACEMENT_CHECKS_MS) {
        await sleep(delay);
        await this.placeWindowsNow().catch((error: unknown) =>
          this.log.warn(`dsh-chrome: could not place the sessions' windows: ${String(error)}`),
        );
      }
    });
  }

  private async placeWindowsNow(): Promise<void> {
    const connection = this.connection;
    if (connection === undefined) return;
    const placed = new Set<number>();
    for (const page of this.pages.all()) {
      const monitor = page.sessionId === undefined ? undefined : this.monitorFor(page.sessionId);
      if (monitor === undefined) continue;
      try {
        const { windowId } = await connection.send('Browser.getWindowForTarget', {
          targetId: page.targetId,
        });
        if (placed.has(windowId)) continue;
        placed.add(windowId);
        const { bounds } = await connection.send('Browser.getWindowBounds', { windowId });
        if (bounds.windowState === 'minimized' || bounds.windowState === 'fullscreen') continue;
        if (this.isOn(bounds, monitor)) continue;
        await this.moveWindow(connection, windowId, monitor, bounds.windowState === 'maximized');
      } catch {
        // The page or its window closed meanwhile; the others are placed all the same.
      }
    }
  }

  /** The monitor a session's windows go on: its own, or the parking monitor while it has none. */
  private monitorFor(sessionId: string): Monitor | undefined {
    return this.screens.monitorOf(sessionId) ?? this.screens.parkingMonitor;
  }

  /** Whether the middle of a window, as Chrome measures it, is on the monitor. */
  private isOn(bounds: WindowBounds, monitor: Monitor): boolean {
    const factor = this.deviceScaleFactor;
    const x = ((bounds.left ?? 0) + (bounds.width ?? 0) / 2) * factor;
    const y = ((bounds.top ?? 0) + (bounds.height ?? 0) / 2) * factor;
    return (
      x >= monitor.x &&
      x < monitor.x + monitor.width &&
      y >= monitor.y &&
      y < monitor.y + monitor.height
    );
  }

  /** Moves a window onto the monitor: a maximized one to fill it, another to its top left. */
  private async moveWindow(
    connection: CdpConnection,
    windowId: number,
    monitor: Monitor,
    maximized: boolean,
  ): Promise<void> {
    const area = this.dipBounds(monitor);
    if (!maximized) {
      await connection.send('Browser.setWindowBounds', {
        windowId,
        bounds: { left: area.left + POPUP_OFFSET_CSS, top: area.top + POPUP_OFFSET_CSS },
      });
      return;
    }
    // A maximized window moves only once it is not.
    await connection.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'normal' },
    });
    await connection.send('Browser.setWindowBounds', { windowId, bounds: area });
    await connection.send('Browser.setWindowBounds', {
      windowId,
      bounds: { windowState: 'maximized' },
    });
  }

  /** Asks Chrome to bring the session's front window forward, for the user's keys. */
  private async activateSession(sessionId: string): Promise<boolean> {
    const page = (await this.pages.pageInFront(sessionId)) ?? this.pages.ofSession(sessionId)[0];
    if (page === undefined) return false;
    await page.activate();
    return true;
  }

  /**
   * Gives each session that a view shows a monitor of its own, and no other session: the
   * windows of sessions no view shows share the parking monitor, while any has a window or
   * one on the way.
   */
  private reviewScreens(): void {
    for (const sessionId of this.screens.sessions) {
      if (!this.viewers.has(sessionId)) this.screens.remove(sessionId);
    }
    const own = new Set(this.screens.sessions);
    const parked = (sessionId: string | undefined) =>
      sessionId !== undefined && !own.has(sessionId);
    this.screens.setParking(
      this.pages.all().some((page) => parked(page.sessionId)) ||
        [...this.openings.keys()].some(parked),
    );
  }

  private async stopAll(): Promise<void> {
    const chrome = await this.chromeStart?.catch(() => undefined);
    this.chromeStart = undefined;
    this.runningChrome = undefined;
    this.connection = undefined;
    await chrome?.close();
    const display = await this.display?.catch(() => undefined);
    this.display = undefined;
    this.screenStopped();
    await display?.stop();
    this.setState({ kind: 'stopped' });
  }

  private setState(state: ChromeState): void {
    this.current = state;
    for (const listener of [...this.stateListeners]) listener(state);
  }
}

function sameSettings(a: ChromeSettings, b: ChromeSettings): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ChromeSettings>;
  return [...keys].every((key) => a[key] === b[key]);
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
