import { type Server, type Socket } from 'node:net';
import { type Message } from '@vscode-tmux/protocol';
import type { Connection } from './registry.js';
/**
 * One NDJSON peer over a socket. Supports fire-and-forget `send`, and
 * `request` which resolves when a message with the same `id` comes back.
 */
export declare class SocketConnection implements Connection {
    readonly socket: Socket;
    private readonly decoder;
    private readonly pending;
    private handler;
    constructor(socket: Socket);
    onMessage(handler: (m: Message) => void): void;
    send(msg: Message): void;
    request(msg: Message, timeoutMs?: number): Promise<Message>;
    close(): void;
    private dispatch;
}
/** Try to connect to an existing daemon socket; resolves undefined if nothing listens. */
export declare function tryConnect(socketPath: string, timeoutMs?: number): Promise<SocketConnection | undefined>;
export interface ListenOptions {
    socketPath: string;
    onConnection: (conn: SocketConnection) => void;
    onDisconnect: (conn: SocketConnection) => void;
}
/** Listen on a Unix socket, replacing a stale socket file when nothing answers on it. */
export declare function listen(o: ListenOptions): Promise<Server>;
