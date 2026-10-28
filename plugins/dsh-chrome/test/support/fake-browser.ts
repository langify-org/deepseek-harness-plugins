import type { Protocol } from 'devtools-protocol';
import type { CdpTransport } from '../../src/host/chrome/cdp/pipe-transport.ts';

/** A command the fake browser received. */
export interface SentCommand {
  readonly id: number;
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly sessionId: string | undefined;
}

/** What the fake browser answers a command with: a result, or an error Chrome would send. */
export type Answer = unknown | { readonly error: string };

/**
 * A browser at the far end of a CDP connection, scripted by a test: it records the commands
 * it gets, answers them as the test says (an empty result unless told otherwise), and sends
 * the events the test makes it send. Unless told otherwise, it ends a target it is asked to
 * close, as Chrome does.
 */
export class FakeBrowser implements CdpTransport {
  readonly sent: SentCommand[] = [];
  readonly #answers = new Map<string, (command: SentCommand) => Answer | Promise<Answer>>();
  readonly #messageListeners: ((message: string) => void)[] = [];
  readonly #closeListeners: ((reason: Error) => void)[] = [];
  #closed = false;

  /** How the browser answers a method from now on. */
  answer(method: string, answer: (command: SentCommand) => Answer | Promise<Answer>): void {
    this.#answers.set(method, answer);
  }

  /** The browser takes no notice of a method: it never answers it. */
  ignore(method: string): void {
    this.#answers.set(method, () => new Promise(() => {}));
  }

  commands(method: string): SentCommand[] {
    return this.sent.filter((command) => command.method === method);
  }

  /** Sends an event, for the browser or for one of its sessions. */
  emit(method: string, params: unknown, sessionId?: string): void {
    this.#deliver({ method, params, ...(sessionId === undefined ? {} : { sessionId }) });
  }

  /** Attaches a page target, as Chrome does for auto-attach; a new page waits to be let run. */
  attachPage(
    target: Partial<Protocol.Target.TargetInfo> & { targetId: string },
    sessionId: string,
    options: { readonly waitingForDebugger?: boolean } = {},
  ): void {
    this.emit('Target.attachedToTarget', {
      sessionId,
      targetInfo: {
        type: 'page',
        title: '',
        url: 'about:blank',
        attached: true,
        canAccessOpener: false,
        ...target,
      },
      waitingForDebugger: options.waitingForDebugger ?? false,
    });
  }

  /** Chrome closes its end, as when it exits. */
  exit(): void {
    this.close();
  }

  // CdpTransport

  send(message: string): void {
    if (this.#closed) return;
    const { id, method, params, sessionId } = JSON.parse(message) as SentCommand;
    const command: SentCommand = { id, method, params: params ?? {}, sessionId };
    this.sent.push(command);
    const answer = this.#answers.get(method) ?? ((sent: SentCommand) => this.#defaultAnswer(sent));
    void Promise.resolve(answer(command)).then((result) => {
      if (isError(result)) this.#deliver({ id, error: { code: -32000, message: result.error } });
      else this.#deliver({ id, result });
    });
  }

  #defaultAnswer({ method, params }: SentCommand): Answer {
    if (method === 'Target.closeTarget') {
      setImmediate(() => this.emit('Target.targetDestroyed', { targetId: params['targetId'] }));
      return { success: true };
    }
    return {};
  }

  onMessage(listener: (message: string) => void): void {
    this.#messageListeners.push(listener);
  }

  onClose(listener: (reason: Error) => void): void {
    if (this.#closed) listener(new Error('closed'));
    else this.#closeListeners.push(listener);
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    for (const listener of this.#closeListeners.splice(0)) listener(new Error('Chrome exited'));
  }

  #deliver(message: object): void {
    if (this.#closed) return;
    const text = JSON.stringify(message);
    for (const listener of this.#messageListeners) listener(text);
  }
}

function isError(value: unknown): value is { readonly error: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as { error?: unknown }).error === 'string'
  );
}

/** Lets pending promise callbacks and the fake browser's answers run. */
export function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
