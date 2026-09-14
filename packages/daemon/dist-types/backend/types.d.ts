/** A terminal tab inside a workspace session (a tmux window). */
export interface Tab {
    /** Backend-stable id for the life of the server (tmux `@N`). */
    id: string;
    index: number;
    name: string;
    cwd: string;
    active: boolean;
    /** Foreground command of the active pane. */
    command: string;
}
/** An attached client of the backend (a tmux client). */
export interface Client {
    tty: string;
    termname: string;
    control: boolean;
    session: string;
    pid: number;
}
export interface CreateSessionOptions {
    name: string;
    cwd: string;
    env: Record<string, string>;
    firstTabName: string;
}
export interface NewTabOptions {
    name: string;
    cwd: string;
    command?: string[];
}
/**
 * Process lifecycle backend: named sessions that survive terminal windows,
 * tabs inside them, and the ability to point an attached client at a session.
 */
export interface SessionBackend {
    ensureServer(): Promise<void>;
    hasSession(name: string): Promise<boolean>;
    createSession(o: CreateSessionOptions): Promise<void>;
    listSessions(): Promise<string[]>;
    listTabs(session: string): Promise<Tab[]>;
    newTab(session: string, o: NewTabOptions): Promise<Tab>;
    selectTab(session: string, tabId: string): Promise<void>;
    listClients(): Promise<Client[]>;
    switchClient(tty: string, session: string): Promise<void>;
    /** argv a terminal should run to attach a client (creating `session` if needed). */
    attachCommand(session: string): string[];
}
