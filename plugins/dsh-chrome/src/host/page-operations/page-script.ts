import type { ChromePage } from '../chrome/pages/page.ts';

/**
 * Evaluates an expression in the page's main world, where its own scripts run, and in no
 * other: another world could be an extension's, such as a password manager's. The page's
 * scripts can therefore influence what the expression reads (by overriding a getter, say),
 * which the callers accept for what they read: the page's text and its pixel density.
 * @returns the expression's value, as JSON.
 * @throws when the expression throws.
 */
export async function evaluateInPage(page: ChromePage, expression: string): Promise<unknown> {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);
  return result.value;
}
