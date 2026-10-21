import { clipText } from './clip-text.ts';

const MAX_TITLE_CHARS = 120;

/**
 * A page's title as the model reads it. The title is page content, which the page's
 * author chose: it is quoted, kept to one line, and shortened, so that it reads as a name
 * rather than as instructions.
 */
export function quotedTitle(title: string): string {
  const line = title.replace(/\s+/g, ' ').trim() || '(untitled)';
  return JSON.stringify(clipText(line, MAX_TITLE_CHARS));
}
