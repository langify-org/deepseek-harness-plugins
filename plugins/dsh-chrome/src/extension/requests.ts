import {
  type AnyRequestMessage,
  type ConnectorErrorCode,
  isConnectorCdpMethod,
  type ResponseMessage,
} from '../protocol/connector.ts';
import type { OwnedPages } from './owned-pages.ts';

/** Answers one host request. Every failure becomes an error response, never a throw. */
export async function answerRequest(
  request: AnyRequestMessage,
  pages: OwnedPages,
): Promise<ResponseMessage> {
  const { id } = request;
  try {
    switch (request.method) {
      case 'page.open':
        return succeed(id, await pages.open(request.params.url, request.params.group));
      case 'page.close':
        if (!pages.owns(request.params.tabId)) return notOwned(id, request.params.tabId);
        await pages.close(request.params.tabId);
        return succeed(id, null);
      case 'page.activate':
        if (!pages.owns(request.params.tabId)) return notOwned(id, request.params.tabId);
        await pages.activate(request.params.tabId);
        return succeed(id, null);
      case 'page.list':
        return succeed(id, { pages: await pages.list() });
      case 'cdp.send': {
        const { tabId, method, params } = request.params;
        if (!pages.owns(tabId)) return notOwned(id, tabId);
        if (!isConnectorCdpMethod(method)) {
          return failWith(id, 'method-denied', `the connector does not allow ${method}`);
        }
        const result = await chrome.debugger.sendCommand({ tabId }, method, params);
        return succeed(id, result ?? {});
      }
    }
  } catch (error) {
    return failWith(id, 'chrome-error', error instanceof Error ? error.message : String(error));
  }
}

export function invalidRequest(id: number): ResponseMessage {
  return failWith(id, 'invalid-request', 'the connector could not read this request');
}

function succeed(id: number, result: unknown): ResponseMessage {
  return { type: 'response', id, ok: true, result };
}

function notOwned(id: number, tabId: number): ResponseMessage {
  return failWith(id, 'not-owned', `tab ${tabId} is not a page this connector opened`);
}

function failWith(id: number, code: ConnectorErrorCode, message: string): ResponseMessage {
  return { type: 'response', id, ok: false, error: { code, message } };
}
