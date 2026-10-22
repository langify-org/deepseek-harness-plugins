import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import {
  CONNECTOR_PROTOCOL,
  parseExtensionMessage,
  parseRelayHello,
  type RelayHelloMessage,
  type WelcomeMessage,
} from '../../../protocol/connector.ts';
import type { Log } from '../../platform/log.ts';
import { ConnectedBrowser } from './connected-browser.ts';
import { encodeFrame, FrameDecoder } from './message-framing.ts';

/** A relay must introduce itself and its connector within this time. */
const HANDSHAKE_TIMEOUT_MS = 10_000;
/** Chrome's own limit for messages from an extension to its native host. */
const MAX_EXTENSION_MESSAGE_BYTES = 64 * 1024 * 1024;

export interface ConnectorServerOptions {
  readonly socketPath: string;
  /** The connector version this host ships. A connector running another version is asked to reload. */
  readonly connectorVersion: string;
  readonly onBrowser: (browser: ConnectedBrowser) => void;
  /**
   * Whether a profile's Chrome shows its windows on a screen someone sees; the connector
   * arranges them by it (see `WelcomeMessage.visibleWindows`). Unless told, they are seen.
   */
  readonly visibleWindows?: (profile: string) => boolean;
  readonly log: Log;
}

/**
 * Accepts relays on a Unix socket that only the current OS user can reach, and turns
 * each one that completes the handshake into a {@link ConnectedBrowser}.
 *
 * Handshake: the relay sends `relay-hello`, the connector sends `hello`, the host
 * answers `welcome`. A connector speaking another protocol gets `welcome` (which can
 * ask it to reload) and is then disconnected.
 */
export class ConnectorServer {
  readonly #server: Server;
  readonly #socketPath: string;
  readonly #sockets = new Set<Socket>();

  private constructor(server: Server, socketPath: string) {
    this.#server = server;
    this.#socketPath = socketPath;
  }

  static async listen(options: ConnectorServerOptions): Promise<ConnectorServer> {
    await prepareSocketDirectory(dirname(options.socketPath));
    await removeStaleSocket(options.socketPath);
    const server = createServer();
    const instance = new ConnectorServer(server, options.socketPath);
    server.on('connection', (socket) => instance.#accept(socket, options));
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    await chmod(options.socketPath, 0o600);
    return instance;
  }

  async close(): Promise<void> {
    for (const socket of this.#sockets) socket.destroy();
    await new Promise<void>((resolve) => this.#server.close(() => resolve()));
    await unlink(this.#socketPath).catch(() => {});
  }

  #accept(socket: Socket, options: ConnectorServerOptions): void {
    this.#sockets.add(socket);
    socket.once('close', () => this.#sockets.delete(socket));
    socket.on('error', (error) =>
      options.log.warn(`connector connection failed: ${error.message}`),
    );

    const decoder = new FrameDecoder(MAX_EXTENSION_MESSAGE_BYTES);
    const handshakeTimer = setTimeout(() => {
      options.log.warn('a connector did not complete the handshake in time');
      socket.destroy();
    }, HANDSHAKE_TIMEOUT_MS);
    socket.once('close', () => clearTimeout(handshakeTimer));

    let relay: RelayHelloMessage | undefined;
    let browser: ConnectedBrowser | undefined;
    socket.on('data', (chunk: Buffer) => {
      let values: unknown[];
      try {
        values = decoder.push(chunk);
      } catch (error) {
        options.log.warn(`dropping a connector that sent an unreadable frame: ${String(error)}`);
        socket.destroy();
        return;
      }
      for (const value of values) {
        if (socket.destroyed) return;
        if (relay === undefined) {
          relay = parseRelayHello(value);
          if (relay?.protocol !== CONNECTOR_PROTOCOL) {
            options.log.warn('dropping a relay that speaks another protocol');
            socket.destroy();
          }
          continue;
        }
        const message = parseExtensionMessage(value);
        if (message === undefined) {
          options.log.warn('dropping a connector message this protocol does not define');
          continue;
        }
        if (browser !== undefined) {
          browser.receive(message);
          continue;
        }
        if (message.type !== 'hello') {
          options.log.warn('dropping a connector that did not say hello first');
          socket.destroy();
          return;
        }
        clearTimeout(handshakeTimer);
        const visibleWindows = options.visibleWindows?.(relay.profile) ?? true;
        const welcome: WelcomeMessage = {
          type: 'welcome',
          protocol: CONNECTOR_PROTOCOL,
          reloadTo:
            message.extensionVersion === options.connectorVersion ? null : options.connectorVersion,
          visibleWindows,
        };
        socket.write(encodeFrame(welcome));
        if (message.protocol !== CONNECTOR_PROTOCOL) {
          options.log.warn(
            `connector ${message.extensionVersion} speaks protocol ${message.protocol}; asked it to reload`,
          );
          socket.end();
          return;
        }
        browser = new ConnectedBrowser(
          socket,
          {
            profile: relay.profile,
            browserId: message.browserId,
            label: message.label,
            extensionVersion: message.extensionVersion,
          },
          { visibleWindows },
        );
        options.onBrowser(browser);
      }
    });
  }
}

/**
 * The socket directory must be private to this OS user. It is examined itself, not what
 * a symbolic link in its place points to: in a shared temporary directory, another user
 * could have planted one.
 */
async function prepareSocketDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory()) throw new Error(`${directory} is not a directory`);
  if (process.getuid !== undefined && info.uid !== process.getuid()) {
    throw new Error(`${directory} belongs to another user`);
  }
  if ((info.mode & 0o077) !== 0) await chmod(directory, 0o700);
}

/** Removes a socket left by a host that exited; refuses to take over a live one. */
async function removeStaleSocket(socketPath: string): Promise<void> {
  const info = await lstat(socketPath).catch(() => undefined);
  if (info === undefined) return;
  if (!info.isSocket()) throw new Error(`${socketPath} exists and is not a socket`);
  if (await acceptsConnections(socketPath)) {
    throw new Error(`another dsh-chrome host is already listening on ${socketPath}`);
  }
  await unlink(socketPath);
}

function acceptsConnections(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(socketPath);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });
}
