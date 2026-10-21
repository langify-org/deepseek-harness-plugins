import type { Context } from '@deepseek-ai/cordis';
import type {} from '@deepseek-ai/dsh-client-connection';
import type {} from '@deepseek-ai/dsh-host-webserver';

/**
 * Whether an address is DSH's own web UI. In a Chrome profile signed in to DSH, the
 * agent could otherwise open DSH there and use it as the user: approve its own pending
 * actions, or change its permissions. The tools refuse such pages, whatever led to them.
 *
 * DSH is served on its web server's port under any loopback name or its bind address,
 * and under the further names its connection trusts (a tunnel or a proxy in front of it),
 * which DSH's own Host/Origin fence recognizes.
 */
export function dshOriginTest(ctx: Context): (address: string) => boolean {
  return (address) => {
    let url: URL;
    try {
      url = new URL(address);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    const webServer = ctx.get('webServer');
    const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
    if (isLoopbackHostname(url.hostname) || url.hostname === webServer?.host) {
      return port === webServer?.port;
    }
    const connection = ctx.get('connection');
    if (connection === undefined) return false;
    // Without credentials, a name DSH serves is refused as unauthenticated (401), any
    // other as foreign (403).
    return connection.requestRejection({ headers: { host: url.host, origin: url.origin } }) !== 403;
  };
}

function isLoopbackHostname(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}
