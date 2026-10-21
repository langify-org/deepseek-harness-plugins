import { type ChildProcess, spawn } from 'node:child_process';
import { BrowserPipe } from '../../src/host/runtime/browser-pipe.ts';
import { chromeExecutable } from './environment.ts';

/** One tab of a headless Chrome the test drives over CDP, as a user would use it. */
export interface HeadlessTab {
  /** Evaluates an expression in the page, awaiting a returned promise. */
  evaluate<T>(expression: string): Promise<T>;
  /** Sends a CDP command to the tab. */
  send(method: string, params?: object): Promise<unknown>;
  click(x: number, y: number): Promise<void>;
  /** Presses and releases a key that types nothing (Backspace, Tab, …). */
  pressKey(key: string, code: string, keyCode: number): Promise<void>;
  close(): Promise<void>;
}

/** Starts a headless Chrome on a throwaway profile and opens one tab at the URL. */
export async function openHeadlessTab(userDataDir: string, url: string): Promise<HeadlessTab> {
  const chrome: ChildProcess = spawn(
    chromeExecutable,
    [
      '--headless=new',
      '--remote-debugging-pipe',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=900,700',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] },
  );
  const exited = new Promise<void>((resolve) => chrome.once('exit', () => resolve()));
  const pipe = new BrowserPipe(chrome);
  const { targetId } = (await pipe.call('Target.createTarget', { url: 'about:blank' })) as {
    targetId: string;
  };
  const { sessionId } = (await pipe.call('Target.attachToTarget', { targetId, flatten: true })) as {
    sessionId: string;
  };
  const send = (method: string, params: object = {}) => pipe.call(method, params, sessionId);
  await send('Page.navigate', { url });

  return {
    send,
    evaluate: async <T>(expression: string): Promise<T> => {
      const { result, exceptionDetails } = (await send('Runtime.evaluate', {
        expression,
        returnByValue: true,
        awaitPromise: true,
      })) as {
        result: { value?: unknown };
        exceptionDetails?: { text: string; exception?: { description?: string } };
      };
      if (exceptionDetails !== undefined) {
        throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      }
      return result.value as T;
    },
    click: async (x, y) => {
      const base = { x, y, button: 'left', clickCount: 1 };
      await send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed', buttons: 1 });
      await send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased', buttons: 0 });
    },
    pressKey: async (key, code, keyCode) => {
      const base = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
      await send('Input.dispatchKeyEvent', { ...base, type: 'rawKeyDown' });
      await send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    },
    close: async () => {
      await pipe.call('Browser.close', {}).catch(() => {});
      const timer = setTimeout(() => chrome.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    },
  };
}
