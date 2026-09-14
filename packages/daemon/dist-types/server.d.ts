import type { Message } from '@vscode-tmux/protocol';
import type { SessionBackend } from './backend/types.js';
import type { Log } from './log.js';
import type { OpenInput, OpenOutcome } from './opener.js';
import type { Presenter } from './presenter/types.js';
import { Registry, type Connection } from './registry.js';
export interface OpenerLike {
    open(i: OpenInput): Promise<OpenOutcome>;
}
export interface DaemonServerOptions {
    backend: SessionBackend;
    presenter: Presenter;
    opener: OpenerLike;
    stateFile: string;
    socketPath: string;
    /** Environment injected into every new session (workspace id, folder, socket path). */
    sessionEnv: (workspaceId: string, folder: string) => Record<string, string>;
    focusDebounceMs?: number;
    /** Share a registry with the opener; a fresh one is created when omitted. */
    registry?: Registry;
    log: Log;
}
/**
 * Message dispatcher for the daemon. Transport-agnostic: `handle()` receives
 * decoded messages from any connection; replies go back through `conn.send`.
 */
export declare class DaemonServer {
    private readonly o;
    readonly registry: Registry;
    private state;
    private pendingShow;
    private showQueue;
    private readonly focusDebounceMs;
    constructor(o: DaemonServerOptions);
    handle(conn: Connection, msg: Message): Promise<void>;
    /** Called by the transport when a peer goes away. */
    disconnected(conn: Connection): void;
    /** Wait for any debounced presenter work (tests). */
    flush(): Promise<void>;
    private require;
    private onHello;
    /** Make sure the workspace's tmux session exists (it may have been killed behind our back). */
    private ensureSession;
    private onFocus;
    private scheduleShow;
    private enqueueShow;
    private onCreateTerminal;
    private onOpen;
    private list;
    private status;
    /** Persist the current tabs of a workspace (names, cwd, and the start command when we know it). */
    private snapshot;
    private reply;
    private replyError;
}
