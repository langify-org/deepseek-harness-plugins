/**
 * The screen Chrome draws on, as programs of other users would find it, and as dsh-chrome
 * lays it out and reads it: Xvnc and Openbox, started as dsh-chrome starts them, in a
 * temporary runtime directory.
 *
 * Needs Xvnc and Openbox.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { type Display, startDisplay } from '../../src/host/chrome/display/display.ts';
import { XConnection, XError } from '../../src/host/chrome/display/x-connection.ts';
import {
  missingRequirements,
  windowManagerExecutable,
  xvncExecutable,
} from '../support/environment.ts';
import { cookieOf, probeXServer } from '../support/x11-probe.ts';

const skip = await missingRequirements({ chrome: true });

let workDir = '';
let display: Display | undefined;

before(async () => {
  if (skip) return;
  workDir = await mkdtemp(join(tmpdir(), 'dsh-chrome-display-'));
  display = await startDisplay({
    xvnc: xvncExecutable,
    windowManager: windowManagerExecutable,
    runtimeDir: join(workDir, 'run'),
    size: { width: 800, height: 600 },
  });
});

after(async () => {
  await display?.stop();
  if (workDir !== '') await rm(workDir, { recursive: true, force: true });
});

function requireDisplay(): Display {
  assert.ok(display, 'the screen did not start');
  return display;
}

/** The X server's socket, where X programs of every user connect. */
const xSocket = (screen: Display) => `/tmp/.X11-unix/X${screen.name.slice(1)}`;

test('the X server admits only the programs that show its cookie', { skip }, async () => {
  const screen = requireDisplay();
  const refused = await probeXServer(xSocket(screen));
  assert.equal(refused.admitted, false);
  const cookie = cookieOf(await readFile(screen.authorityPath));
  assert.deepEqual(await probeXServer(xSocket(screen), cookie), { admitted: true });
  const wrong = { name: cookie.name, data: Buffer.alloc(cookie.data.length) };
  assert.equal((await probeXServer(xSocket(screen), wrong)).admitted, false);
});

test('the VNC socket and the cookie are in a directory only the user can enter', {
  skip,
}, async () => {
  const screen = requireDisplay();
  assert.equal((await stat(join(workDir, 'run'))).mode & 0o777, 0o700);
  assert.equal((await stat(screen.vncSocketPath)).mode & 0o777, 0o600);
  assert.equal((await stat(screen.authorityPath)).mode & 0o777, 0o600);
});

test('neither the X server nor VNC listens on TCP', { skip }, async () => {
  const number = Number(requireDisplay().name.slice(1));
  for (const port of [5900 + number, 6000 + number]) {
    const outcome = await new Promise<string>((resolve) => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => {
        socket.destroy();
        resolve('listening');
      });
      socket.once('error', (error: NodeJS.ErrnoException) => resolve(error.code ?? 'error'));
    });
    assert.equal(outcome, 'ECONNREFUSED', `port ${port}`);
  }
});

test('the screen takes a layout of monitors side by side, as Xvnc reports it', {
  skip,
}, async () => {
  const screen = requireDisplay();
  const layout = {
    width: 1700,
    height: 700,
    monitors: [
      { id: 1, x: 0, y: 0, width: 900, height: 700 },
      { id: 2, x: 900, y: 0, width: 800, height: 600 },
    ],
  };
  await screen.setLayout(layout);
  assert.deepEqual(screen.layout, layout);
  // A layout Xvnc cannot make is refused, and the screen keeps the one it has.
  await assert.rejects(
    screen.setLayout({
      width: 40_000,
      height: 700,
      monitors: [{ id: 1, x: 0, y: 0, width: 40_000, height: 700 }],
    }),
    /did not change the screen/,
  );
  assert.deepEqual(screen.layout, layout);
  await screen.setLayout({
    width: 800,
    height: 600,
    monitors: [{ id: 1, x: 0, y: 0, width: 800, height: 600 }],
  });
});

test("the host's own X connection reads the keyboard's focus, and refuses a window that is not there", {
  skip,
}, async () => {
  const screen = requireDisplay();
  const x = await XConnection.connect(screen.name, screen.authorityPath);
  try {
    // Openbox keeps the focus on a window of its own, off the screen, while no other has it.
    const focused = await x.inputFocus();
    if (focused !== undefined) {
      const bounds = await x.boundsOf(focused);
      assert.equal(typeof bounds.width, 'number');
    }
    await assert.rejects(x.focus(0x7fffff), (error: unknown) => error instanceof XError);
    // A refusal leaves the connection usable.
    assert.equal(await x.inputFocus(), focused);
  } finally {
    x.close();
  }
});
