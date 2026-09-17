import type { Exec } from '../exec.js';
import type { Log } from '../log.js';
import { exactTitlePattern, workspacePattern } from './match.js';
import type { WindowRaiser } from './types.js';

export interface XdotoolRaiserOptions {
  exec: Exec;
  log?: Log;
  sleep?: (ms: number) => Promise<void>;
  /** How many times to look for the exact window title (VS Code updates it asynchronously). */
  titleAttempts?: number;
  titleRetryMs?: number;
}

/**
 * X11 raiser. It only sees X11 and XWayland windows, so it is useless for a native Wayland
 * VS Code (Electron >= 38.2 picks Wayland by itself); it remains for X11 sessions.
 * `windowactivate` (_NET_ACTIVE_WINDOW) is subject to focus-stealing prevention (Mutter mostly
 * ignores it; KWin honours it from a tool), a direct raise + XSetInputFocus between XWayland
 * windows is honoured by Mutter; do all three and verify with getactivewindow.
 */
export class XdotoolRaiser implements WindowRaiser {
  private readonly log: Log;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly titleAttempts: number;
  private readonly titleRetryMs: number;

  constructor(private readonly o: XdotoolRaiserOptions) {
    this.log = o.log ?? (() => {});
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.titleAttempts = o.titleAttempts ?? 8;
    this.titleRetryMs = o.titleRetryMs ?? 125;
  }

  async raise(title: string, workspaceName: string): Promise<boolean> {
    const id = await this.findWindow(title, workspaceName);
    if (!id) return false;
    return this.activate(id);
  }

  private async findWindow(title: string, workspaceName: string): Promise<string | undefined> {
    for (let attempt = 0; attempt < this.titleAttempts; attempt++) {
      const ids = await this.search(exactTitlePattern(title));
      if (ids.length >= 1) return ids[0];
      await this.sleep(this.titleRetryMs);
    }
    const loose = await this.search(workspacePattern(workspaceName));
    if (loose.length === 1) return loose[0];
    if (loose.length > 1) this.log(`ambiguous window match for workspace ${workspaceName}: ${loose.join(', ')}`);
    return undefined;
  }

  private async activate(id: string): Promise<boolean> {
    await this.o.exec('xdotool', ['windowactivate', id]);
    await this.o.exec('xdotool', ['windowraise', id]);
    await this.o.exec('xdotool', ['windowfocus', '--sync', id]);
    const active = await this.o.exec('xdotool', ['getactivewindow']);
    const ok = active.code === 0 && Number(active.stdout.trim()) === Number(id);
    if (!ok) this.log(`window ${id} did not become active (active=${active.stdout.trim() || 'unknown'})`);
    return ok;
  }

  private async search(pattern: string): Promise<string[]> {
    const r = await this.o.exec('xdotool', ['search', '--name', pattern]);
    return r.stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }
}
