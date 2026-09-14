import { randomUUID } from 'node:crypto';
import { createConnection, type Socket } from 'node:net';
import { NdjsonDecoder, encode, type Message } from '@vscode-tmux/protocol';

type Pending = { resolve: (m: Message) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/** NDJSON client for the daemon socket, used by the extension host. */
export class DaemonClient {
  private socket: Socket | undefined;
  private readonly decoder = new NdjsonDecoder();
  private readonly pending = new Map<string, Pending>();
  private requestHandler: ((m: Message) => Promise<Message>) | undefined;
  private disconnectHandler: (() => void) | undefined;

  constructor(private readonly socketPath: string) {}

  get connected(): boolean {
    return this.socket !== undefined && !this.socket.destroyed;
  }

  connect(timeoutMs = 2000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = createConnection(this.socketPath);
      socket.setEncoding('utf8');
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error('connect timeout'));
      }, timeoutMs);
      socket.once('connect', () => {
        clearTimeout(timer);
        this.socket = socket;
        resolve();
      });
      socket.once('error', (err) => {
        clearTimeout(timer);
        if (this.socket === socket) this.socket = undefined;
        reject(err);
      });
      socket.on('data', (chunk: string) => {
        for (const msg of this.decoder.push(chunk)) void this.dispatch(msg);
      });
      socket.on('close', () => {
        if (this.socket === socket) this.socket = undefined;
        for (const p of this.pending.values()) {
          clearTimeout(p.timer);
          p.reject(new Error('daemon connection closed'));
        }
        this.pending.clear();
        this.disconnectHandler?.();
      });
    });
  }

  onRequest(handler: (m: Message) => Promise<Message>): void {
    this.requestHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  send(msg: Message): void {
    if (this.socket && !this.socket.destroyed) this.socket.write(encode(msg));
  }

  request(msg: Message, timeoutMs = 15_000): Promise<Message> {
    const id = (msg as { id?: string }).id ?? randomUUID();
    const withId = { ...msg, id } as Message;
    return new Promise((resolve, reject) => {
      if (!this.connected) return reject(new Error('not connected to daemon'));
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for ${msg.type} reply`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send(withId);
    });
  }

  close(): void {
    this.socket?.end();
    this.socket = undefined;
  }

  private async dispatch(msg: Message): Promise<void> {
    const id = (msg as { id?: string }).id;
    if (msg.type === 'result' && id && this.pending.has(id)) {
      const p = this.pending.get(id)!;
      this.pending.delete(id);
      clearTimeout(p.timer);
      p.resolve(msg);
      return;
    }
    if (this.requestHandler) {
      const reply = await this.requestHandler(msg);
      this.send(reply);
    }
  }
}
