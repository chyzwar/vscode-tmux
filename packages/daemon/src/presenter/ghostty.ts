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
export function pickClient(clients: Client[]): Client | undefined {
  const candidates = clients.filter((c) => !c.control);
  return candidates.find((c) => c.termname === 'xterm-ghostty') ?? candidates[0];
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Ghostty as a single-surface container. One Ghostty instance (own class and
 * config) runs one tmux client attached to the lobby session; showing a
 * workspace is a `switch-client` on that client. tmux draws the tab bar.
 */
export class GhosttyPresenter implements Presenter {
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly pollMs: number;
  private launching: Promise<Client> | undefined;

  constructor(private readonly o: GhosttyPresenterOptions) {
    this.sleep = o.sleep ?? defaultSleep;
    this.timeoutMs = o.timeoutMs ?? 5000;
    this.pollMs = o.pollMs ?? 100;
  }

  async ensureVisible(): Promise<void> {
    await this.client();
  }

  async show(session: string): Promise<void> {
    const client = await this.client();
    if (client.session === session) return;
    await this.o.backend.switchClient(client.tty, session);
  }

  /** Find the Ghostty client, launching Ghostty if there is none. Concurrent callers share one launch. */
  private async client(): Promise<Client> {
    const existing = pickClient(await this.o.backend.listClients());
    if (existing) return existing;
    if (!this.launching) {
      this.launching = this.launch().finally(() => {
        this.launching = undefined;
      });
    }
    return this.launching;
  }

  private async launch(): Promise<Client> {
    const { backend, lobbySession } = this.o;
    await backend.ensureServer();
    if (!(await backend.hasSession(lobbySession))) {
      await backend.createSession({ name: lobbySession, cwd: this.o.env.HOME ?? '/', env: {}, firstTabName: 'Shell' });
    }
    const attach = backend.attachCommand(lobbySession).join(' ');
    this.o.spawn(
      'ghostty',
      [`--class=${this.o.appClass}`, '--gtk-single-instance=true', `--config-file=${this.o.configPath}`, `--command=${attach}`],
      this.o.env,
    );
    const deadline = Date.now() + this.timeoutMs;
    for (;;) {
      const c = pickClient(await backend.listClients());
      if (c) return c;
      if (Date.now() >= deadline) throw new Error('no terminal client attached: Ghostty did not connect to tmux in time');
      await this.sleep(this.pollMs);
    }
  }
}
