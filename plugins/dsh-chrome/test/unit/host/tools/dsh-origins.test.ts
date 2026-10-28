import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import { dshOriginTest } from '../../../../src/host/tools/dsh-origins.ts';

interface RejectionRequest {
  readonly headers: { readonly host: string; readonly origin: string };
}

type Rejection = (request: RejectionRequest) => number | undefined;

interface FakeContext {
  readonly ctx: Context;
  readonly requests: RejectionRequest[];
}

const WEB_SERVER = { host: '127.0.0.1', port: 3080 };
const DSH_HOST = 'dsh.example.ts.net:8443';

function fakeContext(
  webServer: { readonly host: string; readonly port: number } | undefined,
  rejection: Rejection | undefined,
): FakeContext {
  const requests: RejectionRequest[] = [];
  const connection =
    rejection === undefined
      ? undefined
      : {
          requestRejection(request: RejectionRequest): number | undefined {
            requests.push(request);
            return rejection(request);
          },
        };
  const ctx = {
    get(name: string): unknown {
      if (name === 'webServer') return webServer;
      if (name === 'connection') return connection;
      return undefined;
    },
  } as unknown as Context;
  return { ctx, requests };
}

function trustedOrForeign(request: RejectionRequest): number {
  return request.headers.host === DSH_HOST ? 401 : 403;
}

test('accepts the DSH web server under every loopback name on its port', () => {
  const { ctx, requests } = fakeContext(WEB_SERVER, trustedOrForeign);
  const isDsh = dshOriginTest(ctx);

  for (const address of [
    'http://127.0.0.1:3080/',
    'http://localhost:3080/x',
    'http://[::1]:3080/',
    'http://127.0.0.2:3080/',
  ]) {
    assert.equal(isDsh(address), true, address);
  }
  assert.deepEqual(requests, []);
});

test('rejects another local server on a different loopback port', () => {
  const { ctx } = fakeContext(WEB_SERVER, trustedOrForeign);
  const isDsh = dshOriginTest(ctx);

  assert.equal(isDsh('http://localhost:3000/'), false);
  assert.equal(isDsh('http://127.0.0.1:8080/'), false);
});

test('asks the connection about a trusted name and about a foreign name', () => {
  const { ctx, requests } = fakeContext(WEB_SERVER, trustedOrForeign);
  const isDsh = dshOriginTest(ctx);

  assert.equal(isDsh('https://dsh.example.ts.net:8443/'), true);
  assert.equal(isDsh('https://example.com/'), false);
  assert.deepEqual(requests, [
    {
      headers: {
        host: 'dsh.example.ts.net:8443',
        origin: 'https://dsh.example.ts.net:8443',
      },
    },
    { headers: { host: 'example.com', origin: 'https://example.com' } },
  ]);
});

test('treats a trusted name the connection does not reject as DSH', () => {
  const { ctx } = fakeContext(WEB_SERVER, () => undefined);
  const isDsh = dshOriginTest(ctx);

  assert.equal(isDsh('https://dsh.example.ts.net:8443/'), true);
});

test('rejects addresses that are not HTTP or HTTPS URLs', () => {
  const { ctx, requests } = fakeContext(WEB_SERVER, trustedOrForeign);
  const isDsh = dshOriginTest(ctx);

  for (const address of ['not a url', 'about:blank', 'file:///etc/passwd']) {
    assert.equal(isDsh(address), false, address);
  }
  assert.deepEqual(requests, []);
});

test('rejects every address when the context provides neither service', () => {
  const { ctx } = fakeContext(undefined, undefined);
  const isDsh = dshOriginTest(ctx);

  for (const address of [
    'http://127.0.0.1:3080/',
    'http://localhost:3080/',
    'https://dsh.example.ts.net:8443/',
    'https://example.com/',
    'about:blank',
  ]) {
    assert.equal(isDsh(address), false, address);
  }
});
