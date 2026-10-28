import type { ConnectionWebSocket } from '@deepseek-ai/dsh-client-connection/client';
import type { ViewerEvent, ViewerRequest } from '../../../src/protocol/viewer.ts';

/** The events a DSH socket delivers (`ConnectionWebSocketEventMap`, which DSH does not export). */
interface SocketEvents {
  readonly open: object;
  readonly error: object;
  readonly close: object;
  readonly message: { readonly data: unknown };
}
type EventName = keyof SocketEvents;

/** The host's end of a viewer socket, as the tab sees it. */
export class FakeSocket implements ConnectionWebSocket {
  readyState = 0;
  readonly sent: ViewerRequest[] = [];
  readonly #listeners = new Map<EventName, Set<(event: never) => void>>();

  send(text: string): void {
    this.sent.push(JSON.parse(text) as ViewerRequest);
  }

  close(): void {
    this.readyState = 3;
  }

  addEventListener<E extends EventName>(
    event: E,
    listener: (event: SocketEvents[E]) => void,
  ): void {
    const listeners = this.#listeners.get(event) ?? new Set();
    listeners.add(listener as (event: never) => void);
    this.#listeners.set(event, listeners);
  }

  removeEventListener<E extends EventName>(
    event: E,
    listener: (event: SocketEvents[E]) => void,
  ): void {
    this.#listeners.get(event)?.delete(listener as (event: never) => void);
  }

  open(): void {
    this.readyState = 1;
    this.#emit('open', {});
  }

  drop(): void {
    this.readyState = 3;
    this.#emit('close', {});
  }

  receive(event: ViewerEvent): void {
    this.#emit('message', { data: JSON.stringify(event) });
  }

  #emit<E extends EventName>(event: E, payload: SocketEvents[E]): void {
    for (const listener of [...(this.#listeners.get(event) ?? [])]) {
      (listener as (payload: SocketEvents[E]) => void)(payload);
    }
  }
}
