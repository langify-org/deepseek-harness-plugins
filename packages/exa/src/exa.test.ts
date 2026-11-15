import { afterEach, describe, expect, it, vi } from 'vitest'
import { exaFetch, exaSearch, fetchResult, searchResult } from './exa.ts'

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchResult', () => {
  it('keeps results with a URL and reads highlights as snippet and summary', () => {
    expect(
      searchResult({
        results: [
          {
            url: 'https://a.example/',
            title: 'A',
            publishedDate: '2026-11-01T00:00:00.000Z',
            highlights: ['first', ' ', 'second'],
          },
          { url: 'https://b.example/', title: null, highlights: ['only'] },
          { title: 'no url' },
          'not an object',
        ],
      }),
    ).toEqual({
      sources: [
        {
          url: 'https://a.example/',
          title: 'A',
          snippet: 'first',
          summary: 'first … second',
          publishedAt: '2026-11-01T00:00:00.000Z',
        },
        { url: 'https://b.example/', snippet: 'only' },
      ],
      truncated: false,
    })
  })

  it('rejects an answer without a results list', () => {
    expect(() => searchResult({ error: 'x' })).toThrow(/no results list/)
  })
})

describe('fetchResult', () => {
  it('returns the page text', () => {
    expect(
      fetchResult(
        {
          results: [{ url: 'https://a.example/final', text: 'body' }],
          statuses: [{ status: 'success' }],
        },
        'https://a.example/',
      ),
    ).toEqual({
      url: 'https://a.example/final',
      statusCode: 200,
      body: { kind: 'text', content: 'body' },
      truncated: false,
    })
  })

  it("returns a page's HTTP error as its status", () => {
    expect(
      fetchResult(
        {
          results: [],
          statuses: [{ status: 'error', error: { tag: 'CRAWL_NOT_FOUND', httpStatusCode: 404 } }],
        },
        'https://a.example/',
      ),
    ).toEqual({
      url: 'https://a.example/',
      statusCode: 404,
      body: { kind: 'text', content: '' },
      truncated: false,
    })
  })

  it('throws when Exa could not reach the page', () => {
    expect(() =>
      fetchResult(
        { results: [], statuses: [{ status: 'error', error: { tag: 'CRAWL_TIMEOUT' } }] },
        'https://a.example/',
      ),
    ).toThrow(/CRAWL_TIMEOUT/)
  })

  it('throws when Exa returned nothing for the page', () => {
    expect(() => fetchResult({ results: [] }, 'https://a.example/')).toThrow(/no content/)
  })
})

describe('requests', () => {
  it('sends the key and the query to /search', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => json({ results: [] }))
    vi.stubGlobal('fetch', fetch)
    await exaSearch('k').search({ query: 'q', maxResults: 3 })
    expect(fetch).toHaveBeenCalledWith('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'q', numResults: 3, contents: { highlights: true } }),
    })
  })

  it("reports Exa's own message for an HTTP error", async () => {
    vi.stubGlobal('fetch', async () => json({ error: 'Insufficient balance' }, 402))
    await expect(exaFetch('k').fetch({ url: 'https://a.example/' })).rejects.toMatchObject({
      code: 'WEB_PROVIDER_ERROR',
      message: 'Exa /contents answered HTTP 402: Insufficient balance',
    })
  })

  it('reports cancellation as WEB_ABORTED', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', async () => {
      controller.abort()
      throw new DOMException('aborted', 'AbortError')
    })
    await expect(exaSearch('k').search({ query: 'q' }, controller.signal)).rejects.toMatchObject({
      code: 'WEB_ABORTED',
    })
  })

  it('is unavailable without a key', () => {
    expect(exaSearch('').available()).toBe(false)
    expect(exaFetch('').available()).toBe(false)
  })
})
