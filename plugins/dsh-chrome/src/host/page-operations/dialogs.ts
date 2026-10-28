import type { ChromePage, PageDialog } from '../chrome/pages/page.ts';
import { boundToSignal } from '../chrome/pages/signal-bound-page.ts';
import { clipText } from './clip-text.ts';

/**
 * JavaScript dialogs (`alert`, `confirm`, `prompt`, and the question whether to leave a
 * page). A dialog blocks its page until someone answers it: until then, the command that
 * made the page open it gets no answer, and the page answers no other.
 */

/** How an operation that a dialog may interrupt ended. */
export type OperationOutcome<T> =
  | { readonly kind: 'completed'; readonly value: T }
  /** The page shows a dialog, whose answer the operation would wait for. */
  | { readonly kind: 'dialog'; readonly dialog: PageDialog };

/**
 * Runs an operation that may make the page open a dialog, such as a click. It ends when the
 * operation does, or as soon as the page shows a dialog, whose answer it would wait for; a
 * dialog already open ends it before it starts. The operation works on the page it is given,
 * which takes no more commands once a dialog interrupted it, so that the rest of it (the
 * second press of a double-click, say) is not done after the answer.
 */
export function untilDialog<T>(
  page: ChromePage,
  operation: (page: ChromePage) => Promise<T>,
): Promise<OperationOutcome<T>> {
  return new Promise((resolve, reject) => {
    const interruption = new AbortController();
    const endOnDialog = (): boolean => {
      const { dialog } = page;
      if (dialog === undefined) return false;
      stop();
      interruption.abort();
      resolve({ kind: 'dialog', dialog });
      return true;
    };
    const stop = page.onChanged(endOnDialog);
    if (endOnDialog()) return;
    operation(boundToSignal(page, interruption.signal)).then(
      (value) => {
        stop();
        resolve({ kind: 'completed', value });
      },
      (error: unknown) => {
        stop();
        if (!endOnDialog()) reject(error);
      },
    );
  });
}

export interface DialogAnswer {
  /** OK, or Cancel. An alert has OK only. */
  readonly accept: boolean;
  /** The text a `prompt` answers with; without it, its default text. */
  readonly promptText?: string | undefined;
}

/** Answers the dialog the page shows. */
export async function answerDialog(page: ChromePage, answer: DialogAnswer): Promise<void> {
  if (page.dialog === undefined) throw new Error('the page shows no dialog');
  await page.send('Page.handleJavaScriptDialog', {
    accept: answer.accept,
    ...(answer.promptText === undefined ? {} : { promptText: answer.promptText }),
  });
}

/** The longest dialog message quoted to the agent: the page writes it. */
const MAX_QUOTED_MESSAGE_CHARS = 500;

/** The dialog in a sentence, its message quoted as the page's own words. */
export function describeDialog(dialog: PageDialog): string {
  const message = JSON.stringify(clipText(dialog.message, MAX_QUOTED_MESSAGE_CHARS));
  switch (dialog.kind) {
    case 'alert':
      return `an alert saying ${message}`;
    case 'confirm':
      return `a confirmation asking ${message}`;
    case 'prompt':
      return `a question asking ${message}, suggesting ${JSON.stringify(dialog.defaultPrompt)}`;
    case 'beforeunload':
      return 'a question whether to leave the page';
  }
}
