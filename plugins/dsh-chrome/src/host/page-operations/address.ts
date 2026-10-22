/**
 * Addresses the agent, or a link from the conversation, may open a page at: web addresses
 * only, completed as a person would type them into an address bar.
 */

const ALLOWED_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);
/** `scheme:` at the start of the text. */
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** `host:port`, which `SCHEME` would otherwise take for a scheme. */
const HOST_AND_PORT = /^[^\s/:?#]+:\d+(?:[/?#]|$)/;
const LOOPBACK_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:[/?#]|$)/i;

/**
 * Turns what the user typed into a URL to load, or `undefined` when it is not a web
 * address. Without a scheme, a loopback host becomes HTTP (local development servers)
 * and any other host becomes HTTPS; `about:blank` is allowed for an empty page.
 *
 * Other schemes are refused: `chrome:` pages hold Chrome's settings and saved passwords,
 * an extension's pages its own data, and `file:`, `javascript:` and `data:` would let a
 * request reach beyond the web.
 */
export function normalizeAddress(input: string): string | undefined {
  const text = input.trim();
  if (text === '') return undefined;
  if (text === 'about:blank') return text;
  const hasScheme = SCHEME.test(text) && !HOST_AND_PORT.test(text);
  const candidate = hasScheme ? text : `${LOOPBACK_HOST.test(text) ? 'http' : 'https'}://${text}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol) || url.username !== '' || url.password !== '') {
    return undefined;
  }
  return url.href;
}

/**
 * The blank documents a web page can show, as Chrome reports their addresses: a new tab's
 * first document has none until its first navigation commits.
 */
const BLANK_DOCUMENTS: ReadonlySet<string> = new Set(['', 'about:blank', 'about:srcdoc']);

/**
 * Whether a page at the address shows web content, which the agent may read and operate: an
 * http or https page, a blob such a page made, or a blank document. Chrome's own pages
 * (`chrome:`, which hold its settings and saved passwords), extensions' pages, and local
 * files are not.
 */
export function isWebPage(url: string): boolean {
  if (BLANK_DOCUMENTS.has(url)) return true;
  try {
    const parsed = new URL(url);
    const inner = parsed.protocol === 'blob:' ? new URL(parsed.pathname) : parsed;
    return ALLOWED_PROTOCOLS.has(inner.protocol);
  } catch {
    return false;
  }
}
