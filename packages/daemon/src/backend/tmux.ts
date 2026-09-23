import type { Exec } from '../exec.js';
import type { Client, Tab } from '@vscode-tmux/protocol';
import type { CreateSessionOptions, NewTabOptions, SessionBackend } from './types.js';

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
export const SEP = '<|>';
const TAB_FORMAT = ['#{window_id}', '#{window_index}', '#{window_name}', '#{window_active}', '#{pane_current_path}', '#{pane_current_command}'].join(SEP);
const CLIENT_FORMAT = ['#{client_tty}', '#{client_termname}', '#{client_control_mode}', '#{client_session}', '#{client_pid}'].join(SEP);

export class TmuxBackend implements SessionBackend {
  constructor(private readonly o: TmuxBackendOptions) {}

  private base(withConfig = false): string[] {
    const a = ['-L', this.o.socketName];
    if (withConfig) a.push('-f', this.o.configPath);
    return a;
  }

  private async run(args: string[], withConfig = false) {
    return this.o.exec('tmux', [...this.base(withConfig), ...args], { env: this.o.env });
  }

  private async must(args: string[], withConfig = false): Promise<string> {
    const r = await this.run(args, withConfig);
    if (r.code !== 0) throw new Error(`tmux ${args[0]} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
    return r.stdout;
  }

  async ensureServer(): Promise<void> {
    await this.must(['start-server'], true);
  }

  async hasSession(name: string): Promise<boolean> {
    const r = await this.run(['has-session', '-t', `=${name}`]);
    return r.code === 0;
  }

  async createSession(o: CreateSessionOptions): Promise<void> {
    const args = ['new-session', '-d', '-s', o.name, '-n', o.firstTabName, '-c', o.cwd];
    for (const [k, v] of Object.entries(o.env)) args.push('-e', `${k}=${v}`);
    await this.must(args, true);
  }

  async listSessions(): Promise<string[]> {
    const r = await this.run(['list-sessions', '-F', '#{session_name}']);
    if (r.code !== 0) return [];
    return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  }

  async listTabs(session: string): Promise<Tab[]> {
    const out = await this.must(['list-windows', '-t', `=${session}`, '-F', TAB_FORMAT]);
    return out
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const [id = '', index = '0', name = '', active = '0', cwd = '', command = ''] = line.split(SEP);
        return { id, index: Number(index), name, cwd, active: active === '1', command };
      });
  }

  async newTab(session: string, o: NewTabOptions): Promise<Tab> {
    const args = ['new-window', '-t', `=${session}:`, '-n', o.name, '-c', o.cwd, '-P', '-F', '#{window_id}'];
    if (o.command && o.command.length > 0) args.push(...o.command);
    const id = (await this.must(args)).trim();
    const tabs = await this.listTabs(session);
    const tab = tabs.find((t) => t.id === id);
    if (!tab) throw new Error(`tmux created window ${id} but it is not listed in session ${session}`);
    return tab;
  }

  async selectTab(session: string, tabId: string): Promise<void> {
    await this.must(['select-window', '-t', `=${session}:${tabId}`]);
  }

  async listClients(): Promise<Client[]> {
    const r = await this.run(['list-clients', '-F', CLIENT_FORMAT]);
    if (r.code !== 0) return [];
    return r.stdout
      .split('\n')
      .filter((l) => l.trim())
      .map((line) => {
        const [tty = '', termname = '', control = '0', session = '', pid = '0'] = line.split(SEP);
        return { tty, termname, control: control === '1', session, pid: Number(pid) };
      });
  }

  async switchClient(tty: string, session: string): Promise<void> {
    await this.must(['switch-client', '-E', '-c', tty, '-t', `=${session}`]);
  }

  /**
   * Hooks that switch the next client (the quake dropdown) to `session` the moment
   * it attaches. Two are needed: `client-attached` fires when it attaches to an
   * existing session, `session-created` when its `new-session -A` created one.
   * The `if` guard keeps the hook from firing on the session it just switched to.
   */
  async setAttachTarget(session: string): Promise<void> {
    const command = `if -F '#{!=:#{client_session},${session}}' 'switch-client -E -t =${session}'`;
    for (const hook of ['client-attached', 'session-created']) {
      await this.must(['set-hook', '-g', hook, command], true);
    }
  }

  attachCommand(session: string): string[] {
    return ['tmux', ...this.base(true), 'new-session', '-A', '-s', session];
  }
}
