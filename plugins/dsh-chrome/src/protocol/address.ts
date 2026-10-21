/**
 * Addresses a page may be opened at or navigated to. Shared by the host, which
 * enforces it, and the viewer's address bar, which applies it as the user types.
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
 * Other schemes are refused: `chrome:` and extension pages cannot be controlled, and
 * `file:`, `javascript:` and `data:` would let a request reach beyond the web.
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
