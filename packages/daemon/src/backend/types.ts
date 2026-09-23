import type { Client, Tab } from '@vscode-tmux/protocol';

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
  /**
   * Point the *next* client that attaches at `session`. The presenter cannot
   * make a dropdown terminal attach on demand (the user does, with the hotkey),
   * so the target has to be waiting in the backend when that happens.
   */
  setAttachTarget(session: string): Promise<void>;
  /** argv a terminal should run to attach a client (creating `session` if needed). */
  attachCommand(session: string): string[];
}
