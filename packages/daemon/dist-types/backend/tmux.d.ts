import type { Exec } from '../exec.js';
import type { Client, CreateSessionOptions, NewTabOptions, SessionBackend, Tab } from './types.js';
export interface TmuxBackendOptions {
    exec: Exec;
    /** `tmux -L <socketName>`: isolates our server from the user's tmux. */
    socketName: string;
    /** Config loaded when the server starts (replaces the user's tmux.conf for this server). */
    configPath: string;
    /** Environment used for every tmux invocation; becomes the server's global env on first start. */
    env: NodeJS.ProcessEnv;
}
/**
 * Field separator for `-F` output. Must be printable ASCII: tmux replaces
 * non-printable characters (including tabs) with `_` when the locale is C.
 */
export declare const SEP = "<|>";
export declare class TmuxBackend implements SessionBackend {
    private readonly o;
    constructor(o: TmuxBackendOptions);
    private base;
    private run;
    private must;
    ensureServer(): Promise<void>;
    hasSession(name: string): Promise<boolean>;
    createSession(o: CreateSessionOptions): Promise<void>;
    listSessions(): Promise<string[]>;
    listTabs(session: string): Promise<Tab[]>;
    newTab(session: string, o: NewTabOptions): Promise<Tab>;
    selectTab(session: string, tabId: string): Promise<void>;
    listClients(): Promise<Client[]>;
    switchClient(tty: string, session: string): Promise<void>;
    attachCommand(session: string): string[];
}
