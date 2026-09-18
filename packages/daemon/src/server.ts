import type { CreateTerminalMessage, HelloMessage, Message, OpenMessage, ResultMessage } from '@vscode-tmux/protocol';
import type { SessionBackend } from './backend/types.js';
import { sessionNameFor } from './ids.js';
import type { Log } from './log.js';
import type { OpenInput, OpenOutcome } from './opener.js';
import type { Presenter } from './presenter/types.js';
import { Registry, type Connection, type WorkspaceRecord } from './registry.js';
import { loadState, saveState, type State } from './state.js';

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
export class DaemonServer {
  readonly registry: Registry;
  private state: State;
  private pendingShow: { workspaceId: string; timer: NodeJS.Timeout } | undefined;
  private showQueue: Promise<void> = Promise.resolve();
  private readonly focusDebounceMs: number;

  constructor(private readonly o: DaemonServerOptions) {
    this.registry = o.registry ?? new Registry();
    this.state = loadState(o.stateFile);
    this.focusDebounceMs = o.focusDebounceMs ?? 50;
    for (const [id, ws] of Object.entries(this.state.workspaces)) {
      this.registry.upsert({ workspaceId: id, folder: ws.folder, workspaceFile: ws.workspaceFile, name: ws.name, sessionName: ws.sessionName });
    }
  }

  async handle(conn: Connection, msg: Message): Promise<void> {
    try {
      switch (msg.type) {
        case 'hello':
          return await this.onHello(conn, msg);
        case 'focus':
          return this.onFocus(msg.workspaceId, msg.focused);
        case 'createTerminal':
          return await this.onCreateTerminal(conn, msg);
        case 'showSession': {
          const rec = this.require(msg.workspaceId);
          this.scheduleShow(msg.workspaceId, 0);
          return this.reply(conn, msg.id, { sessionName: rec.sessionName });
        }
        case 'open':
          return await this.onOpen(conn, msg);
        case 'list':
          return this.reply(conn, msg.id, await this.list());
        case 'status':
          return this.reply(conn, msg.id, await this.status());
        case 'openResult':
        case 'result':
        case 'openRequest':
        case 'windowStateRequest':
          // replies are routed by the transport layer (SocketConnection); nothing to do here
          return;
        default: {
          const unknown = msg as { type: string; id?: string };
          if (unknown.id) this.replyError(conn, unknown.id, `unknown message type ${unknown.type}`);
          return;
        }
      }
    } catch (err) {
      const id = (msg as { id?: string }).id;
      this.o.log(`error handling ${msg.type}: ${(err as Error).stack ?? err}`);
      if (id) this.replyError(conn, id, (err as Error).message);
    }
  }

  /** Called by the transport when a peer goes away. */
  disconnected(conn: Connection): void {
    for (const id of this.registry.detach(conn)) this.o.log(`workspace ${id} disconnected`);
  }

  /** Wait for any debounced presenter work (tests). */
  async flush(): Promise<void> {
    if (this.pendingShow) {
      clearTimeout(this.pendingShow.timer);
      const { workspaceId } = this.pendingShow;
      this.pendingShow = undefined;
      this.enqueueShow(workspaceId);
    }
    await this.showQueue;
  }

  private require(workspaceId: string) {
    const rec = this.registry.get(workspaceId);
    if (!rec) throw new Error(`unknown workspace ${workspaceId}; is the VS Code Tmux extension connected?`);
    return rec;
  }

  private async onHello(conn: Connection, msg: HelloMessage): Promise<void> {
    const sessionName = sessionNameFor(msg.workspaceFile ?? msg.folder, msg.workspaceId);
    const record = { workspaceId: msg.workspaceId, folder: msg.folder, workspaceFile: msg.workspaceFile, name: msg.name, sessionName };
    this.registry.upsert(record);
    this.registry.attach(msg.workspaceId, conn);

    const created = await this.ensureSession(record);
    this.o.log(`${created ? 'created' : 'reattached'} session ${sessionName} for ${msg.folder}`);
    await this.snapshot(msg.workspaceId);
    this.reply(conn, msg.id, { sessionName, created });
    if (msg.focused) this.scheduleShow(msg.workspaceId, 0);
  }

  /** Make sure the workspace's tmux session exists (it may have been killed behind our back). */
  private async ensureSession(rec: WorkspaceRecord): Promise<boolean> {
    await this.o.backend.ensureServer();
    if (await this.o.backend.hasSession(rec.sessionName)) return false;
    await this.o.backend.createSession({ name: rec.sessionName, cwd: rec.folder, env: this.o.sessionEnv(rec.workspaceId, rec.folder), firstTabName: 'Shell' });
    return true;
  }

  private onFocus(workspaceId: string, focused: boolean): void {
    if (!focused) return;
    const rec = this.registry.get(workspaceId);
    if (!rec) {
      this.o.log(`focus for unknown workspace ${workspaceId}`);
      return;
    }
    this.scheduleShow(workspaceId, this.focusDebounceMs);
  }

  private scheduleShow(workspaceId: string, delayMs: number): void {
    if (this.pendingShow) clearTimeout(this.pendingShow.timer);
    const timer = setTimeout(() => {
      this.pendingShow = undefined;
      this.enqueueShow(workspaceId);
    }, delayMs);
    timer.unref();
    this.pendingShow = { workspaceId, timer };
  }

  private enqueueShow(workspaceId: string): void {
    this.showQueue = this.showQueue
      .then(async () => {
        const rec = this.require(workspaceId);
        if (await this.ensureSession(rec)) this.o.log(`recreated missing session ${rec.sessionName}`);
        await this.o.presenter.show(rec.sessionName);
      })
      .catch((err) => this.o.log(`show(${workspaceId}) failed: ${(err as Error).message}`));
  }

  private async onCreateTerminal(conn: Connection, msg: CreateTerminalMessage): Promise<void> {
    const rec = this.require(msg.workspaceId);
    await this.ensureSession(rec);
    const existing = await this.o.backend.listTabs(rec.sessionName);
    const name = msg.name?.trim() || `Terminal ${existing.length + 1}`;
    const tab = await this.o.backend.newTab(rec.sessionName, { name, cwd: msg.cwd ?? rec.folder, command: msg.command });
    await this.o.backend.selectTab(rec.sessionName, tab.id);
    await this.snapshot(msg.workspaceId, msg.command ? { name, command: msg.command } : undefined);
    this.reply(conn, msg.id, { tab });
    this.scheduleShow(msg.workspaceId, 0);
  }

  private async onOpen(conn: Connection, msg: OpenMessage): Promise<void> {
    const input: OpenInput = { cwd: msg.cwd, target: msg.target };
    const workspaceId = msg.workspaceId ?? (msg.sessionName ? this.registry.bySession(msg.sessionName)?.workspaceId : undefined);
    if (workspaceId) input.workspaceId = workspaceId;
    const outcome = await this.o.opener.open(input);
    this.reply(conn, msg.id, outcome);
  }

  private async list() {
    const workspaces = [];
    for (const rec of this.registry.all()) {
      const tabs = (await this.o.backend.hasSession(rec.sessionName)) ? await this.o.backend.listTabs(rec.sessionName) : [];
      workspaces.push({ ...rec, connected: this.registry.connection(rec.workspaceId) !== undefined, tabs });
    }
    return { workspaces };
  }

  private async status() {
    const sessions = await this.o.backend.listSessions();
    const clients = await this.o.backend.listClients();
    const versions = process.versions as { bun?: string; node: string };
    return {
      socket: this.o.socketPath,
      stateFile: this.o.stateFile,
      pid: process.pid,
      runtime: versions.bun ? `bun ${versions.bun}` : `node ${versions.node}`,
      sessions,
      clients,
      connected: this.registry.connectedIds(),
    };
  }

  /** Persist the current tabs of a workspace (names, cwd, and the start command when we know it). */
  private async snapshot(workspaceId: string, started?: { name: string; command: string[] }): Promise<void> {
    const rec = this.require(workspaceId);
    const tabs = await this.o.backend.listTabs(rec.sessionName);
    const previous = this.state.workspaces[workspaceId]?.tabs ?? [];
    const commandFor = (name: string) => (started && started.name === name ? started.command : previous.find((t) => t.name === name)?.command);
    this.state.workspaces[workspaceId] = {
      folder: rec.folder,
      ...(rec.workspaceFile ? { workspaceFile: rec.workspaceFile } : {}),
      name: rec.name,
      sessionName: rec.sessionName,
      tabs: tabs.map((t) => {
        const command = commandFor(t.name);
        return command ? { name: t.name, cwd: t.cwd, command } : { name: t.name, cwd: t.cwd };
      }),
    };
    saveState(this.o.stateFile, this.state);
  }

  private reply(conn: Connection, id: string, data: unknown): void {
    const msg: ResultMessage = { type: 'result', id, ok: true, data };
    conn.send(msg);
  }

  private replyError(conn: Connection, id: string, error: string): void {
    const msg: ResultMessage = { type: 'result', id, ok: false, error };
    conn.send(msg);
  }
}
