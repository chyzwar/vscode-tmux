import { chmodSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { createServer, createConnection, type Server, type Socket } from 'node:net';
import { NdjsonDecoder, PendingRequests, encode, type Message, type Reply, type RequestBody, type RequestType, type ResultOf } from '@vscode-tmux/protocol';
import type { Connection } from './registry.js';

export type Log = (line: string) => void;

/**
 * One NDJSON peer over a socket. Supports fire-and-forget `send`, and typed
 * `request`s that resolve when the `result` with the same `id` comes back.
 */
export class SocketConnection implements Connection {
  private readonly decoder: NdjsonDecoder;
  private readonly rpc = new PendingRequests((m) => this.send(m));
  private handler: ((m: Message) => void) | undefined;

  constructor(
    readonly socket: Socket,
    log?: Log,
  ) {
    this.decoder = new NdjsonDecoder(log && ((line, reason) => log(`dropped message: ${reason} (${line.slice(0, 200)})`)));
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const msg of this.decoder.push(chunk)) if (!this.rpc.settle(msg)) this.handler?.(msg);
    });
    socket.on('close', () => this.rpc.rejectAll('connection closed'));
    socket.on('error', () => {
      /* surfaced through close */
    });
  }

  onMessage(handler: (m: Message) => void): void {
    this.handler = handler;
  }

  send(msg: Message): void {
    if (!this.socket.destroyed) this.socket.write(encode(msg));
  }

  request<T extends RequestType>(type: T, body: RequestBody<T>, timeoutMs = 10_000): Promise<Reply<ResultOf<T>>> {
    return this.rpc.request(type, body, timeoutMs);
  }

  close(): void {
    this.socket.end();
  }
}

/** Try to connect to an existing daemon socket; resolves undefined if nothing listens. */
export function tryConnect(socketPath: string, timeoutMs = 1000): Promise<SocketConnection | undefined> {
  return new Promise((resolve) => {
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(undefined);
    }, timeoutMs);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve(new SocketConnection(socket));
    });
    socket.once('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
  });
}

export interface ListenOptions {
  socketPath: string;
  onConnection: (conn: SocketConnection) => void;
  onDisconnect: (conn: SocketConnection) => void;
  /**
   * Called once if another process replaces our socket file. Node fails a second
   * `listen()` on a bound path with EADDRINUSE; Bun instead unlinks the path and binds
   * its own socket, leaving the first server on an orphaned inode. Polled every
   * `watchIntervalMs` (default 2 s) until the server closes.
   */
  onPathLost?: () => void;
  watchIntervalMs?: number;
  /** Receives one line per message the decoder drops. */
  log?: Log;
}

/** True while the socket file at `socketPath` is still the one we bound (same inode). */
export function ownsSocketPath(socketPath: string, ino: bigint): boolean {
  try {
    return statSync(socketPath, { bigint: true }).ino === ino;
  } catch {
    return false;
  }
}

/**
 * Listen on a Unix socket. Several daemons may start at once (one per VS Code
 * window); exactly one must win. A stale socket file is removed, ENOENT/EADDRINUSE
 * races are retried, and if another daemon answers on the path we give up with
 * `AlreadyRunningError`.
 */
export class AlreadyRunningError extends Error {}

export async function listen(o: ListenOptions): Promise<Server> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (existsSync(o.socketPath)) {
      const live = await tryConnect(o.socketPath, 500);
      if (live) {
        live.close();
        throw new AlreadyRunningError(`another daemon is already listening on ${o.socketPath}`);
      }
      try {
        unlinkSync(o.socketPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
    const server = createServer((socket) => {
      const conn = new SocketConnection(socket, o.log);
      o.onConnection(conn);
      socket.on('close', () => o.onDisconnect(conn));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(o.socketPath, () => {
          server.off('error', reject);
          resolve();
        });
      });
    } catch (err) {
      server.close();
      if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE') {
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
        continue;
      }
      throw err;
    }
    chmodSync(o.socketPath, 0o600);
    if (o.onPathLost) watchOwnership(server, o.socketPath, o.onPathLost, o.watchIntervalMs ?? 2000);
    return server;
  }
  throw new Error(`could not bind ${o.socketPath} after several attempts`);
}

function watchOwnership(server: Server, socketPath: string, onLost: () => void, intervalMs: number): void {
  const ino = statSync(socketPath, { bigint: true }).ino;
  const timer = setInterval(() => {
    if (ownsSocketPath(socketPath, ino)) return;
    clearInterval(timer);
    onLost();
  }, intervalMs);
  timer.unref();
  server.once('close', () => clearInterval(timer));
}
