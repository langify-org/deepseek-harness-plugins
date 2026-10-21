import type { ChromePage } from '../runtime/pages.ts';

/** The name of the world dsh-chrome evaluates in. */
const WORLD_NAME = 'dsh-chrome';

/**
 * Evaluates an expression in an isolated world of a frame: it sees the frame's DOM but
 * none of the page's scripts, so the page cannot change what it reads (an overridden
 * `innerText` or `devicePixelRatio`, say).
 * @returns the expression's value, as JSON.
 * @throws when the expression throws.
 */
export async function evaluateInIsolatedWorld(
  page: ChromePage,
  frameId: string,
  expression: string,
): Promise<unknown> {
  const { executionContextId } = await page.send('Page.createIsolatedWorld', {
    frameId,
    worldName: WORLD_NAME,
  });
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression,
    contextId: executionContextId,
    returnByValue: true,
  });
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);
  return result.value;
}
