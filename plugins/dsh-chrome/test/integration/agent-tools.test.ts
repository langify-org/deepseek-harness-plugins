/**
 * The agent's tools, run the way DSH's tool runtime runs them: arguments checked against
 * each tool's parameter schema, the value it returns checked against its output schema
 * (both with DSH's own validator), then rendered for the model. The built host plugin and
 * its tools row drive a real Chrome, in a temporary profile, on a screen of its own.
 *
 * Needs a build (`pnpm build`), Google Chrome (or DSH_CHROME_TEST_EXECUTABLE), Xvnc and
 * Openbox.
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { type Context, Service } from '@deepseek-ai/cordis';
import type {
  AttachmentId,
  ImageAttachmentRef,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import {
  type JsonSchemaNode,
  type ToolRunContext,
  validateJsonSchemaValue,
} from '@deepseek-ai/dsh-tools';
import type { ChromeService } from '../../src/host/chrome/chrome-service.ts';
import { type DshHost, startDshHost } from '../support/dsh-host.ts';
import {
  chromeExecutable,
  distDir,
  missingRequirements,
  windowManagerExecutable,
  xvncExecutable,
} from '../support/environment.ts';
import { jpegSize } from '../support/jpeg.ts';
import { RecordingTools } from '../support/recording-tools.ts';
import {
  OPENER_PAGE_HTML,
  OPENER_PAGE_PATH,
  TEST_PAGE_HTML,
  TEST_PAGE_TITLE,
} from '../support/test-page.ts';
import { waitFor } from '../support/wait.ts';

const SESSION_ID = 'agent-session';
const OTHER_SESSION_ID = 'other-session';
/** The shared test page, made tall enough to scroll. */
const TALL_PAGE_HTML = TEST_PAGE_HTML.replace(
  '</body>',
  '<div style="position:absolute;top:0;height:4000px;width:1px"></div></body>',
);

/** Stands in for DSH's attachment store; it stores the image re-encoded, as DSH's may. */
class RecordingAttachments extends Service {
  readonly saved: SaveImageAttachment[] = [];

  constructor(ctx: Context) {
    super(ctx, 'attachments');
  }

  async saveImage(input: SaveImageAttachment): Promise<ImageAttachmentRef> {
    this.saved.push(input);
    const size = jpegSize(input.data);
    return {
      attachmentId: `attachment-${this.saved.length}` as AttachmentId,
      mediaType: 'image/webp',
      bytes: 1234,
      width: size?.width ?? 0,
      height: size?.height ?? 0,
      ...(input.name === undefined ? {} : { name: input.name }),
    };
  }
}

/** Stands in for DSH's model catalog: every model reads images. */
class VisionModels extends Service {
  constructor(ctx: Context) {
    super(ctx, 'llm');
  }

  async resolveModelInfo(): Promise<{ inputModalities: readonly string[] }> {
    return { inputModalities: ['text', 'image'] };
  }
}

const skip = await missingRequirements({ chrome: true });

let workDir = '';
let host: DshHost | undefined;
let chrome: ChromeService | undefined;
let tools: RecordingTools | undefined;
let attachments: RecordingAttachments | undefined;
const FRAMING_PATH = '/framing';

/** The test page, served apart from DSH: the tools refuse DSH's own pages. */
let pageServer: Server | undefined;
let pageUrl = '';

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-tools-'));
  host = await startDshHost();
  const { root } = host;
  await root.plugin(RecordingTools);
  await root.plugin(RecordingAttachments);
  await root.plugin(VisionModels);
  await root.plugin(await import(pathToFileURL(join(distDir, 'host', 'index.js')).href), {
    executable: chromeExecutable,
    // Twice the pixels, as on a high-density display: what scaling must get right.
    deviceScaleFactor: 2,
    xvncExecutable,
    windowManagerExecutable,
    profileDir: join(workDir, 'chrome-profile'),
    userChromeDir: join(workDir, 'user-chrome'),
    dataDir: join(workDir, 'data'),
    runtimeDir: join(workDir, 'run'),
  });
  await root.plugin(await import(pathToFileURL(join(distDir, 'host', 'tools.js')).href));
  chrome = root.get('chrome');
  // The services registered above, under the names DSH declares for its own.
  tools = root.get('tools') as unknown as RecordingTools;
  attachments = root.get('attachments') as unknown as RecordingAttachments;
  const server = createServer((request, response) => {
    // A page of the same site as DSH, framing it.
    const body =
      request.url === FRAMING_PATH
        ? `<!doctype html><title>Framing</title><iframe src="${host?.origin}/"></iframe>`
        : request.url === OPENER_PAGE_PATH
          ? OPENER_PAGE_HTML
          : TALL_PAGE_HTML;
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
  });
  pageServer = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  pageUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

after(async () => {
  await host?.dispose();
  await new Promise<void>((resolve) =>
    pageServer ? pageServer.close(() => resolve()) : resolve(),
  );
  if (workDir !== '') await rm(workDir, { recursive: true, force: true });
});

test('the agent opens a page, reads it, and operates it by ref', { skip }, async () => {
  const empty = await run('chrome_pages', {});
  assert.deepEqual(empty.value, { pages: [] });
  assert.match(text(empty.content), /no Chrome pages/);

  // Chrome starts on first use, and the page opens in front, in the session's own window.
  const opened = await run('chrome_open', { url: pageUrl });
  const pageId = (opened.value as { page: { id: string } }).page.id;
  assert.match(text(opened.content), new RegExp(`Opened page ${pageId}`));
  await waitFor(async () => (await evaluate<string>('document.readyState')) === 'complete');

  // Chrome opens no window of its own: the session's page is its only one.
  const listed = (await run('chrome_pages', {})).value as {
    pages: { id: string; url: string; inFront: boolean }[];
  };
  assert.deepEqual(
    listed.pages.map(({ id, inFront }) => ({ id, inFront })),
    [{ id: pageId, inFront: true }],
  );

  const snapshot = await run('chrome_snapshot', {});
  const read = text(snapshot.content);
  assert.match(read, /untrusted/);
  const fieldRef = /textbox "Field" \[ref=(e\d+)\]/.exec(read)?.[1];
  const buttonRef = /button "Go" \[ref=(e\d+)\]/.exec(read)?.[1];
  assert.ok(fieldRef !== undefined && buttonRef !== undefined, read);

  await run('chrome_type', { ref: fieldRef, text: 'hello' });
  assert.equal(await evaluate<string>(`document.getElementById('field').value`), 'hello');
  await run('chrome_press', { keys: 'Backspace' });
  assert.equal(await evaluate<string>(`document.getElementById('field').value`), 'hell');
  // Typing again replaces the field's text, unless told to add to it; and the key after it is
  // the key, not the select-all that replacing began with.
  await run('chrome_type', { ref: fieldRef, text: 'world' });
  assert.equal(await evaluate<string>(`document.getElementById('field').value`), 'world');
  await run('chrome_press', { keys: 'Backspace' });
  assert.equal(await evaluate<string>(`document.getElementById('field').value`), 'worl');
  await run('chrome_type', { ref: fieldRef, text: 'd!', replace: false });
  assert.equal(await evaluate<string>(`document.getElementById('field').value`), 'world!');
  await run('chrome_click', { ref: buttonRef });
  await waitFor(
    async () => (await evaluate<string>(`document.getElementById('go').textContent`)) === 'Clicked',
  );

  await run('chrome_scroll', { pixels: 300 });
  await waitFor(async () => (await evaluate<number>('scrollY')) > 0, 5000, 'the page to scroll');

  const next = await run('chrome_navigate', { url: `${pageUrl}?next` });
  assert.equal((next.value as { loaded: boolean }).loaded, true);
  assert.equal(await evaluate<string>('location.search'), '?next');
  const back = await run('chrome_navigate', { history: 'back' });
  assert.equal((back.value as { loaded: boolean }).loaded, true);
  assert.equal(await evaluate<string>('location.search'), '');
});

test('a screenshot is stored as an attachment at the page’s CSS size', { skip }, async () => {
  // The visible part of the page, scrollbars aside, at its CSS size: Chrome draws two of the
  // screen's pixels per CSS pixel, so the rendering is larger.
  assert.equal(await evaluate<number>('devicePixelRatio'), 2);
  const viewport = await evaluate<{ width: number; height: number }>(
    '({ width: visualViewport.width, height: visualViewport.height })',
  );
  const shot = await run('chrome_screenshot', {});
  const saved = attachments?.saved.at(-1);
  assert.ok(saved, 'no image was stored');
  assert.equal(saved.mediaType, 'image/jpeg');
  const size = jpegSize(saved.data);
  assert.ok(
    size !== undefined &&
      Math.abs(size.width - viewport.width) <= 1 &&
      Math.abs(size.height - viewport.height) <= 1,
    `image ${JSON.stringify(size)}, viewport ${JSON.stringify(viewport)}`,
  );

  // The reference passes through as the store made it, re-encoding included.
  const image = shot.content.find((block) => block.type === 'image');
  assert.ok(image?.type === 'image');
  assert.equal(image.attachment.mediaType, 'image/webp');
  assert.equal(image.attachment.attachmentId, `attachment-${attachments?.saved.length}`);
  assert.match(text(shot.content), new RegExp(TEST_PAGE_TITLE));
});

test('the agent asks the user for help and hears the answer', { skip }, async () => {
  const page = sharedPage();
  const asked = run('chrome_ask_user', { message: 'Please sign in.' });
  const help = requireChrome().helpRequests;
  await waitFor(() => help.ofSession(SESSION_ID) !== undefined, 5000, 'the request');
  const request = help.ofSession(SESSION_ID);
  assert.deepEqual([request?.message, request?.pageId], ['Please sign in.', page.id]);
  assert.equal(help.ofSession(OTHER_SESSION_ID), undefined);
  help.answer(request?.id ?? '', 'done');
  const answered = await asked;
  assert.equal((answered.value as { outcome: string }).outcome, 'done');
  assert.match(text(answered.content), /The user says it is done/);
});

test("a session's tools cannot reach another session's pages", { skip }, async () => {
  const theirs = await requireChrome().openPage(OTHER_SESSION_ID, pageUrl, { openedBy: 'user' });
  await assert.rejects(run('chrome_snapshot', { page: theirs.id }), {
    message: new RegExp(`there is no page ${theirs.id} this session can use`),
  });
  const ours = await run('chrome_pages', {});
  assert.equal(
    (ours.value as { pages: { id: string }[] }).pages.some((page) => page.id === theirs.id),
    false,
  );
  await theirs.close();
});

test('the agent may not open DSH itself, nor operate a page that shows it', { skip }, async () => {
  const dsh = requireHost().origin;
  const port = new URL(dsh).port;
  for (const address of [`${dsh}/`, `http://localhost:${port}/settings`]) {
    await assert.rejects(run('chrome_open', { url: address }), { message: /DSH itself/ }, address);
  }
  const web = (await run('chrome_open', { url: pageUrl })).value as { page: { id: string } };
  await assert.rejects(run('chrome_navigate', { page: web.page.id, url: `${dsh}/` }), {
    message: /DSH itself/,
  });
  await run('chrome_close', { page: web.page.id });

  // The user may take a page there; the tools then leave it alone, except to close it.
  const shown = await requireChrome().openPage(SESSION_ID, `${dsh}/`, { openedBy: 'user' });
  await assert.rejects(run('chrome_snapshot', { page: shown.id }), { message: /DSH itself/ });
  await run('chrome_close', { page: shown.id });
  assert.equal(requireChrome().page(shown.id), undefined);

  // Nor in a frame of another page.
  const framing = await run('chrome_open', { url: new URL(FRAMING_PATH, pageUrl).href });
  const framingId = (framing.value as { page: { id: string } }).page.id;
  await waitFor(
    async () => {
      const refused = await run('chrome_screenshot', { page: framingId }).then(
        () => false,
        (error: unknown) => error instanceof Error && /DSH itself/.test(error.message),
      );
      return refused;
    },
    10_000,
    'the framed DSH to be refused',
  );
  await run('chrome_close', { page: framingId });
});

test("the agent may not read or operate Chrome's own pages, even those the user opened", {
  skip,
}, async () => {
  const settings = await requireChrome().openPage(SESSION_ID, 'chrome://settings/', {
    openedBy: 'user',
  });
  for (const [tool, args] of [
    ['chrome_snapshot', { page: settings.id }],
    ['chrome_screenshot', { page: settings.id }],
    ['chrome_click', { page: settings.id, ref: 'e1' }],
  ] as const) {
    await assert.rejects(run(tool, args), { message: /one of Chrome's own pages/ }, tool);
  }
  await run('chrome_close', { page: settings.id });
});

test("the agent's actions report the pages they open and the dialogs they lead to", {
  skip,
}, async () => {
  const opened = await run('chrome_open', { url: new URL(OPENER_PAGE_PATH, pageUrl).href });
  const openerId = (opened.value as { page: { id: string } }).page.id;
  await waitFor(async () => (await evaluate<string>('document.readyState')) === 'complete');
  const read = text((await run('chrome_snapshot', {})).content);
  const popupRef = /button "Popup" \[ref=(e\d+)\]/.exec(read)?.[1];
  const askRef = /button "Ask" \[ref=(e\d+)\]/.exec(read)?.[1];
  assert.ok(popupRef !== undefined && askRef !== undefined, read);

  const popup = await run('chrome_click', { page: openerId, ref: popupRef });
  const [popupPage] = (popup.value as { opened?: { id: string }[] }).opened ?? [];
  assert.ok(popupPage, text(popup.content));
  assert.match(text(popup.content), new RegExp(`It opened page ${popupPage.id}`));
  const pages = (await run('chrome_pages', {})).value as {
    pages: { id: string; openerId?: string }[];
  };
  assert.equal(pages.pages.find((page) => page.id === popupPage.id)?.openerId, openerId);
  await run('chrome_close', { page: popupPage.id });

  const asked = await run('chrome_click', { page: openerId, ref: askRef });
  assert.equal((asked.value as { dialog?: string }).dialog, 'a confirmation asking "Proceed?"');
  assert.match(text(asked.content), /chrome_answer_dialog/);
  await assert.rejects(run('chrome_snapshot', { page: openerId }), {
    message: /shows a confirmation asking "Proceed\?"/,
  });
  await run('chrome_answer_dialog', { page: openerId, accept: true });
  await waitFor(
    async () => /\btrue\b/.test(text((await run('chrome_snapshot', { page: openerId })).content)),
    10_000,
    'the page to take the answer',
  );
  await assert.rejects(run('chrome_answer_dialog', { page: openerId, accept: true }), {
    message: /shows no dialog/,
  });
  await run('chrome_close', { page: openerId });
});

test("closing the session's pages leaves it none", { skip }, async () => {
  for (const page of requireChrome().pages.ofSession(SESSION_ID)) {
    await run('chrome_close', { page: page.id });
  }
  const listed = (await run('chrome_pages', {})).value as { pages: { id: string }[] };
  assert.deepEqual(requireChrome().pages.ofSession(SESSION_ID), []);
  assert.deepEqual(listed.pages, []);
});

/** Runs a tool as DSH's runtime would, for a turn of the agent's session. */
async function run(
  name: string,
  args: Record<string, unknown>,
): Promise<{ value: unknown; content: ContentBlock[] }> {
  assert.ok(tools, 'the tools did not start');
  const tool = tools.definition(name);
  assert.deepEqual(
    validateJsonSchemaValue(tool.parameters as JsonSchemaNode, args),
    [],
    `${name} arguments`,
  );
  const value = await tool.execute(args, execFor(SESSION_ID));
  assert.deepEqual(validateJsonSchemaValue(tool.output.schema, value), [], `${name} output`);
  // DSH stores the value losslessly as JSON before rendering it.
  const stored = JSON.parse(JSON.stringify(value));
  return { value: stored, content: tool.output.render(args, stored) };
}

function execFor(sessionId: string): ToolRunContext {
  return {
    agent: {
      id: sessionId,
      options: {},
      session: { requestHeader: () => ({ config: { provider: 'test', model: 'vision' } }) },
    },
    signal: AbortSignal.timeout(60_000),
  } as unknown as ToolRunContext;
}

function text(content: readonly ContentBlock[]): string {
  return content.map((block) => (block.type === 'text' ? block.text : '')).join('\n');
}

function requireHost(): DshHost {
  assert.ok(host, 'the host did not start');
  return host;
}

function requireChrome(): ChromeService {
  assert.ok(chrome, 'the plugin did not start');
  return chrome;
}

function sharedPage() {
  const page = requireChrome().pages.ofSession(SESSION_ID)[0];
  assert.ok(page, 'the session has no page');
  return page;
}

async function evaluate<T>(expression: string): Promise<T> {
  const { result, exceptionDetails } = await sharedPage().send('Runtime.evaluate', {
    expression,
    returnByValue: true,
  });
  if (exceptionDetails !== undefined) throw new Error(exceptionDetails.text);
  return result.value as T;
}
