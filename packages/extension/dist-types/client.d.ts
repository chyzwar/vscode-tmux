import { type Message } from '@vscode-tmux/protocol';
/** NDJSON client for the daemon socket, used by the extension host. */
export declare class DaemonClient {
    private readonly socketPath;
    private socket;
    private readonly decoder;
    private readonly pending;
    private requestHandler;
    private disconnectHandler;
    constructor(socketPath: string);
    get connected(): boolean;
    connect(timeoutMs?: number): Promise<void>;
    onRequest(handler: (m: Message) => Promise<Message>): void;
    onDisconnect(handler: () => void): void;
    send(msg: Message): void;
    request(msg: Message, timeoutMs?: number): Promise<Message>;
    close(): void;
    private dispatch;
}
