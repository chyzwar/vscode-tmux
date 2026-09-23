import type { Client } from '@vscode-tmux/protocol';
import type { SessionBackend } from '../backend/types.js';
import type { Log } from '../log.js';
import type { GhosttyRunner } from './runner.js';
import type { Presenter } from './types.js';

export interface GhosttyPresenterOptions {
  backend: SessionBackend;
  /** Probed on first use and kept (systemd unit or plain spawn). */
  runner: () => Promise<GhosttyRunner>;
  lobbySession: string;
  /** cwd of the lobby session. */
  home: string;
  log?: Log;
}

/** The client that represents the Ghostty surface: non-control, preferably xterm-ghostty. */
export function pickClient(clients: Client[]): Client | undefined {
  const candidates = clients.filter((c) => !c.control);
  return candidates.find((c) => c.termname === 'xterm-ghostty') ?? candidates[0];
}

/**
 * Ghostty as a quake dropdown. The companion instance runs windowless in the
 * background; ctrl+` (a global keybind through the XDG GlobalShortcuts portal)
 * toggles its quick terminal, and that surface runs one tmux client.
 *
 * The daemon therefore never opens the window — the user does, at a moment we
 * do not control. Showing a workspace is two things: `switch-client` for the
 * client that is attached right now, and an attach target in the backend for
 * the client that attaches the next time the dropdown is pulled down.
 */
export class GhosttyPresenter implements Presenter {
  private starting: Promise<void> | undefined;

  constructor(private readonly o: GhosttyPresenterOptions) {}

  async ensureVisible(): Promise<void> {
    await this.ensureRunning();
  }

  async show(session: string): Promise<void> {
    // Set the target first: the dropdown may be pulled down at any moment,
    // including while we are starting Ghostty below.
    await this.o.backend.setAttachTarget(session);
    await this.ensureRunning();
    const client = pickClient(await this.o.backend.listClients());
    if (client && client.session !== session) await this.o.backend.switchClient(client.tty, session);
  }

  /** Make sure the companion process is up. Concurrent callers share one start. */
  private async ensureRunning(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.startOnce().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  private async startOnce(): Promise<void> {
    const runner = await this.o.runner();
    if (await runner.isRunning()) return;
    await this.ensureLobby();
    this.o.log?.(`starting companion Ghostty (${runner.name})`);
    await runner.start();
  }

  /** What the dropdown attaches to before any VS Code window has claimed it. */
  private async ensureLobby(): Promise<void> {
    const { backend, lobbySession } = this.o;
    await backend.ensureServer();
    if (await backend.hasSession(lobbySession)) return;
    await backend.createSession({ name: lobbySession, cwd: this.o.home, env: {}, firstTabName: 'Shell' });
  }
}
