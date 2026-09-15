import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, statSync, unlinkSync } from 'node:fs';
import { createServer, createConnection, type Server, type Socket } from 'node:net';
import { NdjsonDecoder, encode, type Message } from '@vscode-tmux/protocol';
import type { Connection } from './registry.js';

/**
 * One NDJSON peer over a socket. Supports fire-and-forget `send`, and
 * `request` which resolves when a message with the same `id` comes back.
 */
export class SocketConnection implements Connection {
  private readonly decoder = new NdjsonDecoder();
  private readonly pending = new Map<string, { resolve: (m: Message) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>();
  private handler: ((m: Message) => void) | undefined;

  constructor(readonly socket: Socket) {
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      for (const msg of this.decoder.push(chunk)) this.dispatch(msg);
    });
    socket.on('close', () => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('connection closed'));
      }
      this.pending.clear();
    });
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

  request(msg: Message, timeoutMs = 10_000): Promise<Message> {
    const id = (msg as { id?: string }).id ?? randomUUID();
    const withId = { ...msg, id } as Message;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for reply to ${msg.type}`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send(withId);
    });
  }

  close(): void {
    this.socket.end();
  }

  private dispatch(msg: Message): void {
    const id = (msg as { id?: string }).id;
    if ((msg.type === 'result' || msg.type === 'openResult') && id && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.resolve(msg);
      return;
    }
    this.handler?.(msg);
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
      const conn = new SocketConnection(socket);
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
