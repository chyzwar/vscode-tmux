import type { Client, SessionBackend } from '../backend/types.js';
import type { Presenter } from './types.js';
export type Spawn = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => void;
export interface GhosttyPresenterOptions {
    backend: SessionBackend;
    spawn: Spawn;
    env: NodeJS.ProcessEnv;
    configPath: string;
    appClass: string;
    lobbySession: string;
    sleep?: (ms: number) => Promise<void>;
    timeoutMs?: number;
    pollMs?: number;
}
/** The client that represents the Ghostty surface: non-control, preferably xterm-ghostty. */
export declare function pickClient(clients: Client[]): Client | undefined;
/**
 * Ghostty as a single-surface container. One Ghostty instance (own class and
 * config) runs one tmux client attached to the lobby session; showing a
 * workspace is a `switch-client` on that client. tmux draws the tab bar.
 */
export declare class GhosttyPresenter implements Presenter {
    private readonly o;
    private readonly sleep;
    private readonly timeoutMs;
    private readonly pollMs;
    private launching;
    constructor(o: GhosttyPresenterOptions);
    ensureVisible(): Promise<void>;
    show(session: string): Promise<void>;
    /** Find the Ghostty client, launching Ghostty if there is none. Concurrent callers share one launch. */
    private client;
    private launch;
}
