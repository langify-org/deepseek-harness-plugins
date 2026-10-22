/**
 * The text cut to at most `maxChars` UTF-16 code units, ending in `ellipsis` when it was
 * cut. The cut never falls inside a surrogate pair, so what is left stays well-formed text.
 */
export function clipText(text: string, maxChars: number, ellipsis = '…'): string {
  if (text.length <= maxChars) return text;
  let end = Math.max(0, maxChars - ellipsis.length);
  const last = text.charCodeAt(end - 1);
  // A high surrogate whose low half would be cut off.
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${ellipsis}`;
}
