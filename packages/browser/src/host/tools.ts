// The model's browser tools. They act on this conversation's Chromium window
// used last, or the one named, which a Browser tab shows the user. Reading
// (listing windows, a screenshot) needs no permission; changing a page asks for
// the same permission as a command outside the sandbox, as the tmux tools do.
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { BrowserWindow, Page, SharedBrowser } from './browser.ts'

/** A stored screenshot, as the model's image block names it. */
export interface ImageValue {
  readonly attachmentId: string
  readonly mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly originalDimensions?: { readonly width: number; readonly height: number }
}

/** What the tools need from the host plugin. */
export interface ToolHost {
  readonly browser: SharedBrowser
  /** The conversation whose windows `agent` uses: its own, or its conversation's for a subagent. */
  owner(agent: Agent): string
  /** Throw unless `agent` may change pages, asking the user if the session's permissions say so. */
  allow(agent: Agent, exec: ToolRunContext, what: string): Promise<void>
  /** Store a PNG for the model, refusing when its model cannot see images. */
  saveImage(exec: ToolRunContext, data: Uint8Array): Promise<ImageValue>
}

const PERMISSION =
  'The browser runs outside your sandbox: this needs the same permission as a command outside it.'
const MAX_RESULT_CHARS = 20_000
const LOAD_TIMEOUT_MS = 15_000

const windowParameter = {
  type: 'integer',
  description:
    "A window id from browser_windows. Without it, this conversation's window used last.",
} as const

const textOutput = {
  schema: { type: 'string' },
  render: (_args: unknown, value: string): ContentBlock[] => [{ type: 'text', text: value }],
} as const

const navigated = z.object({ errorText: z.string().optional() })
const captured = z.object({ data: z.string() })
const point = z.tuple([z.number(), z.number()])
const titled = z.tuple([z.string(), z.string()])

function agentOf(exec: ToolRunContext): Agent {
  if (exec.agent === undefined) throw new Error('The browser tools need a conversation.')
  return exec.agent
}

/** The window a call acts on, which becomes its conversation's window used last. */
async function windowOf(
  host: ToolHost,
  agent: Agent,
  id: number | undefined,
): Promise<BrowserWindow> {
  const windows = await host.browser.windowsOf(host.owner(agent))
  const window = id === undefined ? windows[0] : windows.find((w) => w.windowId === id)
  if (window === undefined) {
    if (id === undefined) {
      throw new Error('This conversation has no browser window. Open one with browser_open.')
    }
    const ids = windows.map((w) => w.windowId).join(', ') || 'none'
    throw new Error(`This conversation has no browser window ${id}. Its windows: ${ids}.`)
  }
  host.browser.use(window)
  return window
}

const LOOPBACK = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i

/**
 * An address to open: http(s) as given, about:blank, or a bare host, as the
 * address bar takes one: over http on this machine and https elsewhere.
 */
export function openableUrl(input: string): string {
  const trimmed = input.trim()
  if (trimmed === 'about:blank') return trimmed
  let url: URL
  try {
    // A colon followed by a digit ends a host, not a scheme: localhost:8080.
    if (/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(trimmed)) url = new URL(trimmed)
    else {
      url = new URL(`http://${trimmed}`)
      if (!LOOPBACK.test(url.hostname)) url.protocol = 'https:'
    }
  } catch {
    throw new Error(`"${input}" is not an address.`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Only http and https addresses open in the browser, not ${url.protocol}`)
  }
  return url.href
}

/** Wait until the page has loaded, or give up waiting after a while. */
async function settle(browser: SharedBrowser, page: Page, signal: AbortSignal): Promise<void> {
  for (const deadline = Date.now() + LOAD_TIMEOUT_MS; Date.now() < deadline;) {
    signal.throwIfAborted()
    // A navigation replaces the page's context midway: those reads fail and are retried.
    const state = await browser.evaluate(page, 'document.readyState').catch(() => undefined)
    if (state?.value === 'complete') return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

async function describe(browser: SharedBrowser, page: Page): Promise<string> {
  const now = titled.safeParse(
    (await browser.evaluate(page, '[document.title, location.href]').catch(() => undefined))?.value,
  )
  const [title, url] = now.success ? now.data : [page.title, page.url]
  return `${title || '(untitled)'} — ${url}`
}

/** How many characters `text` has, as the user sees them. */
function characterCount(text: string): number {
  return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)).length
}

interface KeySpec {
  readonly code: string
  readonly keyCode: number
  readonly text?: string
}

const NAMED_KEYS: Readonly<Record<string, KeySpec>> = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9 },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
}

/** The DOM key, code and Windows key code of a key name, or of a single character. */
export function keySpec(key: string): KeySpec & { readonly key: string } {
  const named = NAMED_KEYS[key]
  if (named !== undefined) return { key: key === 'Space' ? ' ' : key, ...named }
  const fn = /^F([1-9]|1[0-2])$/.exec(key)
  if (fn?.[1] !== undefined) return { key, code: key, keyCode: 111 + Number(fn[1]) }
  if (characterCount(key) === 1) {
    const upper = key.toUpperCase()
    if (/^[A-Z]$/.test(upper))
      return { key, code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: key }
    if (/^[0-9]$/.test(key))
      return { key, code: `Digit${key}`, keyCode: key.charCodeAt(0), text: key }
    return { key, code: '', keyCode: 0, text: key }
  }
  throw new Error(
    `Unknown key "${key}". Use one character, F1–F12, or one of: ${Object.keys(NAMED_KEYS).join(', ')}.`,
  )
}

const MODIFIER_BITS = { Alt: 1, Control: 2, Meta: 4, Shift: 8 } as const
type Modifier = keyof typeof MODIFIER_BITS

const IMAGE_VALUE = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    attachmentId: { type: 'string', required: true },
    mediaType: {
      type: 'string',
      enum: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      required: true,
    },
    bytes: { type: 'integer', required: true },
    width: { type: 'integer', required: true },
    height: { type: 'integer', required: true },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
  },
} as const

/** The browser_* tools, bound to the host's shared browser. */
export function browserTools(host: ToolHost): ToolDefinition[] {
  const { browser } = host
  return [
    defineTool({
      name: 'browser_windows',
      description:
        "List this conversation's browser windows (see Shared browser) with their tabs: which window the other tools use by default, which one is on the user's screen, and which tab each shows.",
      parameters: {},
      output: textOutput,
      async execute(_input, exec) {
        const windows = await browser.windowsOf(host.owner(agentOf(exec)))
        if (windows.length === 0) return 'This conversation has no browser window.'
        const lines: string[] = []
        for (const [index, window] of windows.entries()) {
          const marks = [
            index === 0 ? 'the default' : undefined,
            browser.isFront(window) ? "on the user's screen" : undefined,
            window.tab ? 'in a Browser tab' : 'not in a Browser tab yet',
          ].filter((mark) => mark !== undefined)
          lines.push(`Window ${window.windowId} (${marks.join(', ')}):`)
          const active = await browser.activePage(window).catch(() => undefined)
          for (const page of await browser.pagesOf(window)) {
            const shown = page.targetId === active?.targetId ? ' [shown]' : ''
            lines.push(`  - ${page.title || '(untitled)'} — ${page.url}${shown}`)
          }
        }
        return lines.join('\n')
      },
    }),
    defineTool({
      name: 'browser_open',
      description: `Open an address in this conversation's browser window used last (see Shared browser), making a window when it has none or when new_window is true. Returns the page's title and address once it has loaded. http and https only. ${PERMISSION}`,
      parameters: {
        url: {
          type: 'string',
          required: true,
          description:
            'The address. A bare host opens over https, or over http on this machine (localhost:8080).',
        },
        new_window: {
          type: 'boolean',
          description: 'Open a new window instead; the next Browser tab the user opens shows it.',
        },
      },
      output: textOutput,
      async execute(input, exec) {
        const agent = agentOf(exec)
        const url = openableUrl(input.url)
        await host.allow(agent, exec, `open ${url} in the browser`)
        const session = host.owner(agent)
        const existing =
          input.new_window === true ? undefined : (await browser.windowsOf(session))[0]
        const window = existing ?? (await browser.newWindow(session))
        browser.use(window)
        const page = await browser.activePage(window)
        const result = navigated.parse(await browser.send(page, 'Page.navigate', { url }))
        if (result.errorText !== undefined)
          throw new Error(`Could not open ${url}: ${result.errorText}`)
        await settle(browser, page, exec.signal)
        return `Window ${window.windowId}: ${await describe(browser, page)}`
      },
    }),
    defineTool({
      name: 'browser_screenshot',
      description:
        "See the page a window shows, as an image of its viewport in CSS pixels, the coordinates browser_click takes. Chromium's own menus, prompts and popups do not appear in it.",
      parameters: { window: windowParameter },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            window: { type: 'integer', required: true },
            page: { type: 'string', required: true },
            image: IMAGE_VALUE,
          },
        },
        render: (_args: unknown, value): ContentBlock[] => {
          const { image } = value
          let scale = ''
          if (image.originalDimensions !== undefined) {
            const factor = (image.originalDimensions.width / image.width).toFixed(2)
            scale = `; downscaled from ${image.originalDimensions.width}x${image.originalDimensions.height}, so multiply coordinates measured on it by ${factor}`
          }
          return [
            {
              type: 'text',
              text: `Window ${value.window}: ${value.page}\n${image.width}x${image.height} px${scale}`,
            },
            {
              type: 'image',
              attachment: {
                attachmentId: AttachmentId(image.attachmentId),
                mediaType: image.mediaType,
                bytes: image.bytes,
                width: image.width,
                height: image.height,
                ...(image.originalDimensions === undefined
                  ? {}
                  : { originalDimensions: { ...image.originalDimensions } }),
              },
            },
          ]
        },
      },
      isConcurrencySafe: () => true,
      async execute(input, exec) {
        const window = await windowOf(host, agentOf(exec), input.window)
        const page = await browser.activePage(window)
        const shot = captured.parse(
          await browser.send(page, 'Page.captureScreenshot', { format: 'png' }),
        )
        const image = await host.saveImage(exec, Buffer.from(shot.data, 'base64'))
        return { window: window.windowId, page: await describe(browser, page), image }
      },
    }),
    defineTool({
      name: 'browser_click',
      description: `Click in the page a window shows: on the element a CSS selector finds (scrolled into view first), or at x, y in the viewport's CSS pixels as browser_screenshot shows them. ${PERMISSION}`,
      parameters: {
        selector: { type: 'string', description: 'A CSS selector; its first match is clicked.' },
        x: { type: 'number', description: 'Horizontal position, with y, instead of a selector.' },
        y: { type: 'number', description: 'Vertical position, with x.' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Default left.' },
        double: { type: 'boolean', description: 'Double-click.' },
        window: windowParameter,
      },
      output: textOutput,
      async execute(input, exec) {
        const agent = agentOf(exec)
        const target =
          input.selector ??
          (input.x !== undefined && input.y !== undefined ? `${input.x}, ${input.y}` : undefined)
        if (target === undefined) throw new Error('Give a selector, or both x and y.')
        await host.allow(agent, exec, `click ${target} in the browser`)
        const window = await windowOf(host, agent, input.window)
        const page = await browser.activePage(window)
        let x = input.x ?? 0
        let y = input.y ?? 0
        if (input.selector !== undefined) {
          const found = point.safeParse(
            (
              await browser.evaluate(
                page,
                `(() => {
                  const element = document.querySelector(${JSON.stringify(input.selector)})
                  if (element === null) return null
                  element.scrollIntoView({ block: 'center', inline: 'center' })
                  const box = element.getBoundingClientRect()
                  return [box.x + box.width / 2, box.y + box.height / 2]
                })()`,
              )
            ).value,
          )
          if (!found.success) throw new Error(`Nothing matches ${input.selector}.`)
          ;[x, y] = found.data
        }
        const button = input.button ?? 'left'
        await browser.send(page, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
        for (let count = 1; count <= (input.double === true ? 2 : 1); count++) {
          for (const type of ['mousePressed', 'mouseReleased']) {
            await browser.send(page, 'Input.dispatchMouseEvent', {
              type,
              x,
              y,
              button,
              clickCount: count,
            })
          }
        }
        return `Clicked ${input.selector ?? 'the page'} at ${Math.round(x)}, ${Math.round(y)}.`
      },
    }),
    defineTool({
      name: 'browser_type',
      description: `Type text into the focused field of the page a window shows, as if pasted: any language, no key events. Focus a field first with browser_click. ${PERMISSION}`,
      parameters: {
        text: { type: 'string', required: true, description: 'The text to type.' },
        window: windowParameter,
      },
      output: textOutput,
      async execute(input, exec) {
        const agent = agentOf(exec)
        await host.allow(agent, exec, 'type into the browser')
        const page = await browser.activePage(await windowOf(host, agent, input.window))
        await browser.send(page, 'Input.insertText', { text: input.text })
        return `Typed ${characterCount(input.text)} characters.`
      },
    }),
    defineTool({
      name: 'browser_key',
      description: `Press a key in the page a window shows, with modifiers held: Enter to submit, Tab, Escape, arrows, PageDown, F1–F12, or one character, such as a with Control to select all. ${PERMISSION}`,
      parameters: {
        key: { type: 'string', required: true, description: 'A key name or one character.' },
        modifiers: {
          type: 'array',
          items: { type: 'string', enum: ['Alt', 'Control', 'Meta', 'Shift'] },
          description: 'Modifiers held while the key is pressed.',
        },
        window: windowParameter,
      },
      output: textOutput,
      async execute(input, exec) {
        const agent = agentOf(exec)
        const spec = keySpec(input.key)
        const held = (input.modifiers ?? []).filter((m): m is Modifier => m in MODIFIER_BITS)
        await host.allow(agent, exec, `press ${[...held, input.key].join('+')} in the browser`)
        const page = await browser.activePage(await windowOf(host, agent, input.window))
        const modifiers = held.reduce((bits, m) => bits | MODIFIER_BITS[m], 0)
        // Held Control or Meta makes a shortcut, which types nothing.
        const typed =
          spec.text !== undefined && (modifiers & (2 | 4)) === 0 ? { text: spec.text } : {}
        const event = {
          key: spec.key,
          code: spec.code,
          windowsVirtualKeyCode: spec.keyCode,
          modifiers,
        }
        await browser.send(page, 'Input.dispatchKeyEvent', { type: 'keyDown', ...event, ...typed })
        await browser.send(page, 'Input.dispatchKeyEvent', { type: 'keyUp', ...event })
        return `Pressed ${[...held, input.key].join('+')}.`
      },
    }),
    defineTool({
      name: 'browser_eval',
      description: `Evaluate a JavaScript expression in the page a window shows and get its JSON value; a promise is awaited. Use it to read the DOM, fill or select form fields, or scroll. ${PERMISSION}`,
      parameters: {
        expression: { type: 'string', required: true, description: 'The expression.' },
        window: windowParameter,
      },
      output: textOutput,
      async execute(input, exec) {
        const agent = agentOf(exec)
        await host.allow(agent, exec, 'run JavaScript in the browser')
        const page = await browser.activePage(await windowOf(host, agent, input.window))
        const { value, description } = await browser.evaluate(page, input.expression)
        const json =
          value === undefined ? (description ?? 'undefined') : JSON.stringify(value, null, 2)
        return json.length > MAX_RESULT_CHARS
          ? `${json.slice(0, MAX_RESULT_CHARS)}\n… (${json.length - MAX_RESULT_CHARS} more characters)`
          : json
      },
    }),
  ]
}
