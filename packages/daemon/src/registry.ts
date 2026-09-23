import type { Message, Reply, RequestBody, RequestType, ResultOf, WorkspaceRecord } from '@vscode-tmux/protocol';

/** A live peer (an extension host) we can push messages to and await typed replies from. */
export interface Connection {
  send(msg: Message): void;
  request<T extends RequestType>(type: T, body: RequestBody<T>, timeoutMs?: number): Promise<Reply<ResultOf<T>>>;
}

/** In-memory map of known workspaces and which of them currently have a VS Code window connected. */
export class Registry {
  private readonly records = new Map<string, WorkspaceRecord>();
  private readonly connections = new Map<string, Connection>();

  upsert(r: WorkspaceRecord): void {
    this.records.set(r.workspaceId, { ...r });
  }

  get(id: string): WorkspaceRecord | undefined {
    return this.records.get(id);
  }

  /** Reverse lookup for requests that only know which tmux session they came from. */
  bySession(sessionName: string): WorkspaceRecord | undefined {
    for (const r of this.records.values()) if (r.sessionName === sessionName) return r;
    return undefined;
  }

  all(): WorkspaceRecord[] {
    return [...this.records.values()];
  }

  attach(id: string, c: Connection): void {
    this.connections.set(id, c);
  }

  detach(c: Connection): string[] {
    const ids: string[] = [];
    for (const [id, conn] of this.connections) {
      if (conn === c) {
        this.connections.delete(id);
        ids.push(id);
      }
    }
    return ids;
  }

  connection(id: string): Connection | undefined {
    return this.connections.get(id);
  }

  connectedIds(): string[] {
    return [...this.connections.keys()];
  }
}
