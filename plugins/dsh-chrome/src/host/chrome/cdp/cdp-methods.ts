import type { ProtocolMapping } from 'devtools-protocol/types/protocol-mapping.js';

/**
 * The Chrome DevTools Protocol as dsh-chrome uses it: the commands it sends and the events it
 * listens to, typed by the `devtools-protocol` package. The connection refuses any other
 * command. Chrome holds the user's sign-ins, so what the plugin may do with it stays written
 * down here, and grows only by a change to this list.
 */
export const CDP_COMMANDS = [
  // The browser.
  'Browser.close',
  'Browser.getVersion',
  'Target.activateTarget',
  'Target.closeTarget',
  'Target.getTargets',
  'Target.createTarget',
  'Target.setAutoAttach',
  'Target.setDiscoverTargets',
  // A page.
  'Accessibility.getFullAXTree',
  'DOM.focus',
  'DOM.getContentQuads',
  'DOM.scrollIntoViewIfNeeded',
  'Input.dispatchKeyEvent',
  'Input.dispatchMouseEvent',
  'Input.insertText',
  'Page.captureScreenshot',
  'Page.createIsolatedWorld',
  'Page.enable',
  'Page.getFrameTree',
  'Page.getLayoutMetrics',
  'Page.getNavigationHistory',
  'Page.handleJavaScriptDialog',
  'Page.navigate',
  'Page.navigateToHistoryEntry',
  'Page.reload',
  'Runtime.evaluate',
  'Runtime.runIfWaitingForDebugger',
] as const satisfies readonly (keyof ProtocolMapping.Commands)[];

export const CDP_EVENTS = [
  'Target.attachedToTarget',
  'Target.detachedFromTarget',
  'Target.targetCreated',
  'Target.targetDestroyed',
  'Target.targetInfoChanged',
  'Page.frameNavigated',
  'Page.javascriptDialogClosed',
  'Page.javascriptDialogOpening',
  'Page.loadEventFired',
  'Page.navigatedWithinDocument',
] as const satisfies readonly (keyof ProtocolMapping.Events)[];

export type CdpCommand = (typeof CDP_COMMANDS)[number];
export type CdpEventName = (typeof CDP_EVENTS)[number];
export type CdpResult<M extends CdpCommand> = ProtocolMapping.Commands[M]['returnType'];
export type CdpEventParams<E extends CdpEventName> = ProtocolMapping.Events[E];

type CdpParams<M extends CdpCommand> = ProtocolMapping.Commands[M]['paramsType'];

/**
 * The arguments after a command's name: its parameters (required exactly when CDP
 * requires them), then options of type `O`.
 */
export type CdpArgs<M extends CdpCommand, O> =
  CdpParams<M> extends []
    ? [params?: undefined, options?: O]
    : CdpParams<M> extends [infer P]
      ? [params: P, options?: O]
      : [params?: NonNullable<CdpParams<M>[0]>, options?: O];

const COMMANDS: ReadonlySet<string> = new Set(CDP_COMMANDS);

export function isCdpCommand(method: string): method is CdpCommand {
  return COMMANDS.has(method);
}
