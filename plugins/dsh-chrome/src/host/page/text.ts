import type { ChromePage } from '../runtime/pages.ts';
import { clipText } from './clip-text.ts';
import { evaluateInPage } from './page-script.ts';

export interface PageText {
  readonly title: string;
  readonly url: string;
  readonly text: string;
  readonly truncated: boolean;
}

/**
 * The page's visible text, as the user would copy it: `document.body.innerText`. The page
 * shapes what it shows anyway, so its scripts shaping what this reads changes little.
 */
export async function readPageText(page: ChromePage, maxChars: number): Promise<PageText> {
  const { frameTree } = await page.send('Page.getFrameTree');
  let value: { title?: unknown; text?: unknown } | undefined;
  try {
    value = (await evaluateInPage(
      page,
      '({ title: document.title, text: document.body ? document.body.innerText : "" })',
    )) as typeof value;
  } catch (error) {
    throw new Error(`could not read the page: ${error instanceof Error ? error.message : error}`);
  }
  const title = typeof value?.title === 'string' ? value.title : page.title;
  const fullText = typeof value?.text === 'string' ? value.text : '';
  const truncated = fullText.length > maxChars;
  return {
    title,
    url: frameTree.frame.url,
    text: clipText(fullText, maxChars, ''),
    truncated,
  };
}

/** The page's text as a Markdown document, to add to a message. */
export function pageTextMarkdown(page: PageText): string {
  const note = page.truncated ? '\n\n(The page text was cut short.)' : '';
  return `# ${page.title || page.url}\n\n<${page.url}>\n\n${page.text.trim()}${note}\n`;
}
