import type { ChromePage, PageDialog } from '../chrome/pages/page.ts';
import { clipText } from './clip-text.ts';

/**
 * JavaScript dialogs (`alert`, `confirm`, `prompt`, and the question whether to leave a
 * page). A dialog blocks its page until someone answers it: until then, the command that
 * made the page open it gets no answer, and the page answers no other.
 */

/** How an operation that a dialog may interrupt ended. */
export type UntilDialog<T> =
  | { readonly completed: T; readonly dialog?: undefined }
  | { readonly completed?: undefined; readonly dialog: PageDialog };

/**
 * Runs an operation that may make the page open a dialog, such as a click. It ends when the
 * operation does, or as soon as the page opens a dialog, whose answer it would wait for. The
 * interrupted operation finishes once the dialog is answered, and its outcome is dropped.
 */
export function untilDialog<T>(
  page: ChromePage,
  operation: () => Promise<T>,
): Promise<UntilDialog<T>> {
  return new Promise((resolve, reject) => {
    const endOnDialog = (): boolean => {
      const { dialog } = page;
      if (dialog === undefined) return false;
      stop();
      resolve({ dialog });
      return true;
    };
    const stop = page.onChanged(endOnDialog);
    operation().then(
      (completed) => {
        stop();
        resolve({ completed });
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
