import { existsSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { basename, join } from 'node:path';
import { errorResult, okResult, type DaemonRequestType, type Message, type OpenRequestMessage, type Reply, type RequestBody, type ResultMessage, type ResultOf } from '@vscode-tmux/protocol';
import * as vscode from 'vscode';
import { DaemonClient } from './client.js';
import { identityFromStorageUri, type WorkspaceIdentity } from './identity.js';
import { spawnDaemon } from './spawn.js';
import { DEFAULT_TITLE_TEMPLATE, predictTitle } from './title.js';

const SOCKET_PATH = `/run/user/${userInfo().uid}/vscode-tmux.sock`;
const DEFAULT_DAEMON_PATH = join(homedir(), '.local', 'bin', 'vscode-tmux');
let warnedMissingDaemon = false;

/** The compiled daemon binary: the `vscode-tmux.daemonPath` setting, else what install.bash installs. */
function daemonBinaryPath(): string {
  const configured = vscode.workspace.getConfiguration('vscode-tmux').get<string>('daemonPath')?.trim();
  return configured || DEFAULT_DAEMON_PATH;
}

let output: vscode.OutputChannel;
const log = (s: string) => output.appendLine(`${new Date().toISOString()} ${s}`);

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  output = vscode.window.createOutputChannel('VS Code Tmux');
  context.subscriptions.push(output);

  const identity = identityFromStorageUri(
    context.storageUri?.fsPath,
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    vscode.workspace.workspaceFile?.scheme === 'file' ? vscode.workspace.workspaceFile.fsPath : undefined,
    vscode.workspace.name ?? '',
  );
  if (!identity) {
    log('no workspace folder in this window; VS Code Tmux stays idle');
    return;
  }
  log(`workspace ${identity.name} id=${identity.workspaceId} folder=${identity.folder}`);

  const session = new Session(context, identity);
  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-tmux.createTerminal', () => session.createTerminal()),
    vscode.commands.registerCommand('vscode-tmux.showSession', () => session.showSession()),
    vscode.window.onDidChangeWindowState((state) => session.onWindowState(state)),
    { dispose: () => session.dispose() },
  );
  void session.start();
}

export function deactivate(): void {}

class Session {
  private client: DaemonClient | undefined;
  private disposed = false;
  private reconnecting = false;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly identity: WorkspaceIdentity,
  ) {}

  async start(): Promise<void> {
    await this.connectWithSpawn();
  }

  dispose(): void {
    this.disposed = true;
    this.client?.close();
  }

  onWindowState(state: vscode.WindowState): void {
    this.send({ type: 'focus', workspaceId: this.identity.workspaceId, focused: state.focused });
  }

  async createTerminal(): Promise<void> {
    const name = await vscode.window.showInputBox({ prompt: 'Terminal tab name', placeHolder: 'Claude, Server, Tests', ignoreFocusOut: true });
    if (name === undefined) return;
    const body: RequestBody<'createTerminal'> = { workspaceId: this.identity.workspaceId };
    if (name.trim()) body.name = name.trim();
    const reply = await this.request('createTerminal', body);
    if (!reply.ok) void vscode.window.showErrorMessage(`VS Code Tmux: ${reply.error}`);
  }

  async showSession(): Promise<void> {
    const reply = await this.request('showSession', { workspaceId: this.identity.workspaceId });
    if (!reply.ok) void vscode.window.showErrorMessage(`VS Code Tmux: ${reply.error}`);
  }

  private send(msg: Message): void {
    if (!this.client?.connected) {
      void this.reconnect();
      return;
    }
    this.client.send(msg);
  }

  /** A typed request to the daemon; transport failures come back as `{ ok: false }` so callers have one path. */
  private async request<T extends DaemonRequestType>(type: T, body: RequestBody<T>): Promise<Reply<ResultOf<T>>> {
    if (!this.client?.connected) await this.connectWithSpawn();
    if (!this.client?.connected) {
      void vscode.window.showErrorMessage('VS Code Tmux: daemon is not reachable (see the VS Code Tmux output channel)');
      return { ok: false, error: 'daemon is not reachable' };
    }
    try {
      return await this.client.request(type, body);
    } catch (err) {
      log(`request ${type} failed: ${(err as Error).message}`);
      return { ok: false, error: (err as Error).message };
    }
  }

  private async connectWithSpawn(): Promise<void> {
    if (await this.tryConnect()) return;
    // Several windows may notice the missing daemon at once: stagger, then re-check.
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 400));
    if (await this.tryConnect()) return;
    const bin = daemonBinaryPath();
    if (!existsSync(bin)) {
      log(`daemon binary not found at ${bin}; run install.bash or set vscode-tmux.daemonPath`);
      if (!warnedMissingDaemon) {
        warnedMissingDaemon = true;
        void vscode.window.showErrorMessage(`VS Code Tmux: daemon binary not found at ${bin}. Run install.bash or set vscode-tmux.daemonPath.`);
      }
      return;
    }
    try {
      const r = spawnDaemon(bin, process.env, log);
      log(`spawned daemon: ${r.method}: ${r.command}`);
    } catch (err) {
      log(`failed to spawn daemon: ${(err as Error).message}`);
      return;
    }
    for (let i = 0; i < 25 && !this.disposed; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await this.tryConnect()) return;
    }
    log('daemon did not come up; giving up for now');
  }

  private async tryConnect(): Promise<boolean> {
    const client = new DaemonClient(SOCKET_PATH, log);
    try {
      await client.connect();
    } catch {
      return false;
    }
    this.client = client;
    client.onRequest((m) => this.handleRequest(m));
    client.onDisconnect(() => {
      log('daemon connection closed');
      if (!this.disposed) void this.reconnect(2000);
    });
    const hello: RequestBody<'hello'> = {
      workspaceId: this.identity.workspaceId,
      folder: this.identity.folder,
      name: this.identity.name,
      extHostPid: process.pid,
      focused: vscode.window.state.focused,
    };
    if (this.identity.workspaceFile) hello.workspaceFile = this.identity.workspaceFile;
    if (process.env.VSCODE_PID) hello.vscodePid = Number(process.env.VSCODE_PID);
    const reply = await client.request('hello', hello);
    log(reply.ok ? `hello reply: ${JSON.stringify(reply.data)}` : `hello failed: ${reply.error}`);
    return true;
  }

  private async reconnect(delayMs = 500): Promise<void> {
    if (this.reconnecting || this.disposed) return;
    this.reconnecting = true;
    try {
      await new Promise((r) => setTimeout(r, delayMs));
      await this.connectWithSpawn();
    } finally {
      this.reconnecting = false;
    }
  }

  private async handleRequest(msg: Message): Promise<ResultMessage> {
    switch (msg.type) {
      case 'windowStateRequest':
        return okResult(msg, { focused: vscode.window.state.focused });
      case 'openRequest':
        return this.openFile(msg);
      default:
        return errorResult('id' in msg ? msg.id : '', `unexpected ${msg.type}`);
    }
  }

  private async openFile(req: OpenRequestMessage): Promise<ResultMessage> {
    try {
      const uri = vscode.Uri.file(req.path);
      const stat = await vscode.workspace.fs.stat(uri);
      let editorShort = '';
      if (stat.type & vscode.FileType.Directory) {
        // `vscode .`: bring this window forward and reveal the folder in the explorer.
        await vscode.commands.executeCommand('revealInExplorer', uri).then(undefined, () => undefined);
        editorShort = vscode.window.activeTextEditor ? basename(vscode.window.activeTextEditor.document.fileName) : '';
      } else {
        const doc = await vscode.workspace.openTextDocument(uri);
        const line = Math.max(0, (req.line ?? 1) - 1);
        const col = Math.max(0, (req.col ?? 1) - 1);
        const pos = new vscode.Position(Math.min(line, doc.lineCount - 1), col);
        const editor = await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), preview: false });
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
        editorShort = basename(doc.fileName);
      }
      const title = this.predictWindowTitle(editorShort);
      log(`opened ${req.path}${req.line ? ':' + req.line : ''}; predicted title ${JSON.stringify(title)}`);
      return okResult(req, { title });
    } catch (err) {
      log(`open failed: ${(err as Error).message}`);
      return errorResult(req.id, (err as Error).message);
    }
  }

  private predictWindowTitle(activeEditorShort: string): string {
    const cfg = vscode.workspace.getConfiguration('window');
    const template = cfg.get<string>('title') || DEFAULT_TITLE_TEMPLATE;
    const separator = cfg.get<string>('titleSeparator') || ' - ';
    const dirty = vscode.window.activeTextEditor?.document.isDirty ? '● ' : '';
    const folder = this.identity.folder;
    return predictTitle(
      template,
      {
        dirty,
        activeEditorShort,
        activeEditorMedium: activeEditorShort,
        activeEditorLong: activeEditorShort,
        rootName: vscode.workspace.name ?? basename(folder),
        rootNameShort: basename(folder),
        rootPath: folder,
        folderName: basename(folder),
        folderPath: folder,
        appName: vscode.env.appName,
        profileName: '',
        remoteName: vscode.env.remoteName ?? '',
        activeRepositoryName: '',
        activeRepositoryBranchName: '',
      },
      separator,
    );
  }
}
