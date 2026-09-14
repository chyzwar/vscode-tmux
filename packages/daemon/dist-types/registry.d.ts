import type { Message } from '@vscode-tmux/protocol';
export interface WorkspaceRecord {
    workspaceId: string;
    folder: string;
    workspaceFile?: string;
    name: string;
    sessionName: string;
}
/** A live peer (an extension host) we can push messages to and await replies from. */
export interface Connection {
    send(msg: Message): void;
    request(msg: Message, timeoutMs?: number): Promise<Message>;
}
/** In-memory map of known workspaces and which of them currently have a VS Code window connected. */
export declare class Registry {
    private readonly records;
    private readonly connections;
    upsert(r: WorkspaceRecord): void;
    get(id: string): WorkspaceRecord | undefined;
    all(): WorkspaceRecord[];
    attach(id: string, c: Connection): void;
    detach(c: Connection): string[];
    connection(id: string): Connection | undefined;
    connectedIds(): string[];
}
