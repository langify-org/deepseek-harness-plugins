// Exa's search and contents APIs as DSH web providers, behind the shipped
// web_search and web_fetch tools. Nothing here reaches DeepSeek.
import {
  WebError,
  type WebFetchProvider,
  type WebFetchResult,
  type WebSearchProvider,
  type WebSearchResult,
  type WebSearchSource,
} from '@deepseek-ai/dsh-web'

/** The id both providers register under; profiles select it on the `web` row. */
export const PROVIDER_ID = 'exa'

const BASE_URL = 'https://api.exa.ai'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/**
 * POSTs one request to Exa and returns its parsed JSON body.
 * @throws {@link WebError} `WEB_ABORTED` when `signal` aborts, `WEB_PROVIDER_ERROR` for a
 *   failed request, a non-2xx answer (with Exa's own message, such as an exhausted balance on
 *   402) or a body that is not JSON.
 */
async function post(
  path: '/search' | '/contents',
  body: unknown,
  apiKey: string,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  const failed = (what: string, cause: unknown): WebError =>
    signal?.aborted
      ? new WebError('Exa request aborted', 'WEB_ABORTED', { cause })
      : new WebError(`${what}: ${String(cause)}`, 'WEB_PROVIDER_ERROR', { cause })
  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    })
  } catch (cause) {
    throw failed(`Exa ${path} request failed`, cause)
  }
  if (!response.ok) {
    const detail = await response.json().then(
      (json: unknown) => (isRecord(json) ? text(json['error']) : undefined),
      () => undefined,
    )
    throw new WebError(
      `Exa ${path} answered HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
      'WEB_PROVIDER_ERROR',
    )
  }
  try {
    return await response.json()
  } catch (cause) {
    throw failed(`Exa ${path} returned a body that is not JSON`, cause)
  }
}

/** Maps an Exa `/search` answer to citeable sources, skipping results without a URL. */
export function searchResult(payload: unknown): WebSearchResult {
  const results = isRecord(payload) ? payload['results'] : undefined
  if (!Array.isArray(results)) {
    throw new WebError('Exa /search returned no results list', 'WEB_PROVIDER_ERROR')
  }
  const sources: WebSearchSource[] = []
  for (const result of results) {
    if (!isRecord(result)) continue
    const url = text(result['url'])
    if (url === undefined) continue
    const highlights = Array.isArray(result['highlights'])
      ? result['highlights'].flatMap((highlight) => text(highlight) ?? [])
      : []
    const title = text(result['title'])
    const publishedAt = text(result['publishedDate'])
    sources.push({
      url,
      ...(title !== undefined ? { title } : {}),
      ...(highlights[0] !== undefined ? { snippet: highlights[0] } : {}),
      ...(highlights.length > 1 ? { summary: highlights.join(' … ') } : {}),
      ...(publishedAt !== undefined ? { publishedAt } : {}),
    })
  }
  return { sources, truncated: false }
}

/**
 * Maps an Exa `/contents` answer for one URL to a fetch result. A page Exa reached but that
 * answered with an HTTP error is a result with that status, as for a direct fetch.
 */
export function fetchResult(payload: unknown, url: string): WebFetchResult {
  const status =
    isRecord(payload) && Array.isArray(payload['statuses']) ? payload['statuses'][0] : undefined
  if (isRecord(status) && status['status'] === 'error') {
    const error = isRecord(status['error']) ? status['error'] : {}
    const code = error['httpStatusCode']
    if (typeof code === 'number' && Number.isInteger(code) && code >= 100 && code <= 599) {
      return { url, statusCode: code, body: { kind: 'text', content: '' }, truncated: false }
    }
    const tag = text(error['tag']) ?? 'unknown error'
    throw new WebError(`Exa could not fetch ${url} (${tag})`, 'WEB_PROVIDER_ERROR')
  }
  const result =
    isRecord(payload) && Array.isArray(payload['results']) ? payload['results'][0] : undefined
  if (!isRecord(result)) {
    throw new WebError(`Exa returned no content for ${url}`, 'WEB_PROVIDER_ERROR')
  }
  return {
    url: text(result['url']) ?? url,
    statusCode: 200,
    body: { kind: 'text', content: typeof result['text'] === 'string' ? result['text'] : '' },
    truncated: false,
  }
}

const description = {
  en: "Exa's web search, with the key in the configured environment variable (EXA_API_KEY by default). Billed by Exa per search.",
  ja: 'Exa の Web 検索。キーは設定した環境変数（既定は EXA_API_KEY）から読みます。料金は検索ごとに Exa が請求します。',
  zh: 'Exa 网页搜索，密钥读取自配置的环境变量（默认 EXA_API_KEY）。由 Exa 按次计费。',
}

const fetchDescription = {
  en: "Exa's page contents: Exa reads the page (from its cache, or live) and returns its text. Billed by Exa per page.",
  ja: 'Exa のページ本文。Exa がページを読み（キャッシュか、その場で）、本文のテキストを返します。料金はページごとに Exa が請求します。',
  zh: 'Exa 页面内容：由 Exa 读取页面（缓存或实时抓取）并返回正文文本。由 Exa 按页计费。',
}

/** The search provider; usable once `apiKey` is non-empty. */
export function exaSearch(apiKey: string): WebSearchProvider {
  return {
    id: PROVIDER_ID,
    title: 'Exa',
    description,
    available: () => apiKey !== '',
    search: async (request, signal) =>
      searchResult(
        await post(
          '/search',
          {
            query: request.query,
            ...(request.maxResults !== undefined ? { numResults: request.maxResults } : {}),
            contents: { highlights: true },
          },
          apiKey,
          signal,
        ),
      ),
  }
}

/** The fetch provider; usable once `apiKey` is non-empty. */
export function exaFetch(apiKey: string): WebFetchProvider {
  return {
    id: PROVIDER_ID,
    title: 'Exa',
    description: fetchDescription,
    available: () => apiKey !== '',
    fetch: async (request, signal) =>
      fetchResult(
        await post('/contents', { urls: [request.url], text: true }, apiKey, signal),
        request.url,
      ),
  }
}
