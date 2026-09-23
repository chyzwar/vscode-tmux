import { createConnection, type Socket } from 'node:net';
import { NdjsonDecoder, PendingRequests, encode, type DaemonRequestType, type Message, type Reply, type RequestBody, type ResultMessage, type ResultOf } from '@vscode-tmux/protocol';

/** NDJSON client for the daemon socket, used by the extension host. */
export class DaemonClient {
  private socket: Socket | undefined;
  private readonly decoder: NdjsonDecoder;
  private readonly rpc = new PendingRequests((m) => this.send(m));
  private requestHandler: ((m: Message) => Promise<ResultMessage>) | undefined;
  private disconnectHandler: (() => void) | undefined;

  constructor(
    private readonly socketPath: string,
    log?: (line: string) => void,
  ) {
    this.decoder = new NdjsonDecoder(log && ((line, reason) => log(`dropped message: ${reason} (${line.slice(0, 200)})`)));
  }

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
        this.rpc.rejectAll('daemon connection closed');
        this.disconnectHandler?.();
      });
    });
  }

  /** Requests the daemon sends us (`openRequest`, `windowStateRequest`); the handler's reply goes straight back. */
  onRequest(handler: (m: Message) => Promise<ResultMessage>): void {
    this.requestHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  send(msg: Message): void {
    if (this.socket && !this.socket.destroyed) this.socket.write(encode(msg));
  }

  request<T extends DaemonRequestType>(type: T, body: RequestBody<T>, timeoutMs = 15_000): Promise<Reply<ResultOf<T>>> {
    if (!this.connected) return Promise.reject(new Error('not connected to daemon'));
    return this.rpc.request(type, body, timeoutMs);
  }

  close(): void {
    this.socket?.end();
    this.socket = undefined;
  }

  private async dispatch(msg: Message): Promise<void> {
    if (this.rpc.settle(msg)) return;
    if (msg.type === 'result') return; // a reply to a request we gave up on
    if (this.requestHandler) this.send(await this.requestHandler(msg));
  }
}
