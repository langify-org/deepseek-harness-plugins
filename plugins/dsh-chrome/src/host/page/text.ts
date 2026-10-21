import type { ChromePage } from '../runtime/pages.ts';

export interface PageText {
  readonly title: string;
  readonly url: string;
  readonly text: string;
  readonly truncated: boolean;
}

/** A world of its own, so page scripts cannot change what `innerText` returns. */
const WORLD_NAME = 'dsh-chrome';

/**
 * The page's visible text, as the user would copy it: `document.body.innerText`,
 * read in an isolated world.
 */
export async function readPageText(page: ChromePage, maxChars: number): Promise<PageText> {
  const { frameTree } = await page.send('Page.getFrameTree');
  const { executionContextId } = await page.send('Page.createIsolatedWorld', {
    frameId: frameTree.frame.id,
    worldName: WORLD_NAME,
  });
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression: '({ title: document.title, text: document.body ? document.body.innerText : "" })',
    contextId: executionContextId,
    returnByValue: true,
  });
  if (exceptionDetails !== undefined)
    throw new Error(`could not read the page: ${exceptionDetails.text}`);
  const value = result.value as { title?: unknown; text?: unknown } | undefined;
  const title = typeof value?.title === 'string' ? value.title : page.title;
  const fullText = typeof value?.text === 'string' ? value.text : '';
  const truncated = fullText.length > maxChars;
  return {
    title,
    url: frameTree.frame.url,
    text: truncated ? fullText.slice(0, maxChars) : fullText,
    truncated,
  };
}

/** The page's text as a Markdown document, to add to a message. */
export function pageTextMarkdown(page: PageText): string {
  const note = page.truncated ? '\n\n(The page text was cut short.)' : '';
  return `# ${page.title || page.url}\n\n<${page.url}>\n\n${page.text.trim()}${note}\n`;
}
