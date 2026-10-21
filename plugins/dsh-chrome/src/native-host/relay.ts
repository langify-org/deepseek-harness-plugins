/**
 * Native messaging host of the connector extension.
 *
 * Chrome starts this program when the connector opens its native port, and talks to
 * it over stdio. The program connects to the dsh-chrome connector socket, introduces
 * itself with one `relay-hello` frame, and then passes bytes through in both
 * directions: Chrome's framing is also the socket's framing.
 *
 * Its launcher, written by the host plugin, sets the socket path and the profile name.
 */
import { connect } from 'node:net';
import { CONNECTOR_PROTOCOL, type RelayHelloMessage } from '../protocol/connector.ts';

const SOCKET_ENV = 'DSH_CHROME_CONNECTOR_SOCKET';
/** How long the relay waits for Chrome to take its last output before exiting anyway. */
const FLUSH_WAIT_MS = 2000;
const PROFILE_ENV = 'DSH_CHROME_PROFILE';

function fail(message: string, exitCode: number): never {
  // Chrome copies the host's stderr into its own log.
  process.stderr.write(`dsh-chrome native host: ${message}\n`);
  process.exit(exitCode);
}

function frame(message: RelayHelloMessage): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  return Buffer.concat([header, body]);
}

const socketPath = process.env[SOCKET_ENV];
const profile = process.env[PROFILE_ENV];
if (!socketPath || !profile) fail(`${SOCKET_ENV} and ${PROFILE_ENV} must be set`, 2);

const socket = connect(socketPath);
socket.once('connect', () => {
  socket.write(frame({ type: 'relay-hello', protocol: CONNECTOR_PROTOCOL, profile }));
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
// The connector reconnects with backoff, so exiting is the right answer to a host
// that is not running.
socket.once('error', (error) => fail(error.message, 1));
socket.once('close', () => {
  // What the host sent last must still reach Chrome: on some platforms stdout is written
  // asynchronously, and exiting at once would drop it.
  process.stdout.end(() => process.exit(0));
  setTimeout(() => process.exit(0), FLUSH_WAIT_MS).unref();
});
process.stdin.once('end', () => socket.end());
