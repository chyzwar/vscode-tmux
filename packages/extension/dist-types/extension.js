"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const node_os_1 = require("node:os");
const node_path_1 = require("node:path");
const vscode = __importStar(require("vscode"));
const client_js_1 = require("./client.js");
const identity_js_1 = require("./identity.js");
const spawn_js_1 = require("./spawn.js");
const title_js_1 = require("./title.js");
const SOCKET_PATH = `/run/user/${(0, node_os_1.userInfo)().uid}/vscode-tmux.sock`;
const DEFAULT_DAEMON_PATH = (0, node_path_1.join)((0, node_os_1.homedir)(), '.local', 'bin', 'vscode-tmux');
let warnedMissingDaemon = false;
/** The compiled daemon binary: the `vscode-tmux.daemonPath` setting, else what install.bash installs. */
function daemonBinaryPath() {
    const configured = vscode.workspace.getConfiguration('vscode-tmux').get('daemonPath')?.trim();
    return configured || DEFAULT_DAEMON_PATH;
}
let output;
const log = (s) => output.appendLine(`${new Date().toISOString()} ${s}`);
async function activate(context) {
    output = vscode.window.createOutputChannel('VS Code Tmux');
    context.subscriptions.push(output);
    const identity = (0, identity_js_1.identityFromStorageUri)(context.storageUri?.fsPath, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, vscode.workspace.workspaceFile?.scheme === 'file' ? vscode.workspace.workspaceFile.fsPath : undefined, vscode.workspace.name ?? '');
    if (!identity) {
        log('no workspace folder in this window; VS Code Tmux stays idle');
        return;
    }
    log(`workspace ${identity.name} id=${identity.workspaceId} folder=${identity.folder}`);
    const session = new Session(context, identity);
    context.subscriptions.push(vscode.commands.registerCommand('vscode-tmux.createTerminal', () => session.createTerminal()), vscode.commands.registerCommand('vscode-tmux.showSession', () => session.showSession()), vscode.window.onDidChangeWindowState((state) => session.onWindowState(state)), { dispose: () => session.dispose() });
    void session.start();
}
function deactivate() { }
class Session {
    context;
    identity;
    client;
    disposed = false;
    reconnecting = false;
    constructor(context, identity) {
        this.context = context;
        this.identity = identity;
    }
    async start() {
        await this.connectWithSpawn();
    }
    dispose() {
        this.disposed = true;
        this.client?.close();
    }
    onWindowState(state) {
        this.send({ type: 'focus', workspaceId: this.identity.workspaceId, focused: state.focused });
    }
    async createTerminal() {
        const name = await vscode.window.showInputBox({ prompt: 'Terminal tab name', placeHolder: 'Claude, Server, Tests', ignoreFocusOut: true });
        if (name === undefined)
            return;
        const msg = { type: 'createTerminal', id: (0, node_crypto_1.randomUUID)(), workspaceId: this.identity.workspaceId };
        if (name.trim())
            msg.name = name.trim();
        const reply = await this.request(msg);
        if (!reply?.ok)
            void vscode.window.showErrorMessage(`VS Code Tmux: ${reply?.error ?? 'could not create terminal'}`);
    }
    async showSession() {
        const reply = await this.request({ type: 'showSession', id: (0, node_crypto_1.randomUUID)(), workspaceId: this.identity.workspaceId });
        if (!reply?.ok)
            void vscode.window.showErrorMessage(`VS Code Tmux: ${reply?.error ?? 'could not show session'}`);
    }
    send(msg) {
        if (!this.client?.connected) {
            void this.reconnect();
            return;
        }
        this.client.send(msg);
    }
    async request(msg) {
        if (!this.client?.connected)
            await this.connectWithSpawn();
        if (!this.client?.connected) {
            void vscode.window.showErrorMessage('VS Code Tmux: daemon is not reachable (see the VS Code Tmux output channel)');
            return undefined;
        }
        try {
            return (await this.client.request(msg));
        }
        catch (err) {
            log(`request ${msg.type} failed: ${err.message}`);
            return { type: 'result', id: msg.id, ok: false, error: err.message };
        }
    }
    async connectWithSpawn() {
        if (await this.tryConnect())
            return;
        // Several windows may notice the missing daemon at once: stagger, then re-check.
        await new Promise((r) => setTimeout(r, 100 + Math.random() * 400));
        if (await this.tryConnect())
            return;
        const bin = daemonBinaryPath();
        if (!(0, node_fs_1.existsSync)(bin)) {
            log(`daemon binary not found at ${bin}; run install.bash or set vscode-tmux.daemonPath`);
            if (!warnedMissingDaemon) {
                warnedMissingDaemon = true;
                void vscode.window.showErrorMessage(`VS Code Tmux: daemon binary not found at ${bin}. Run install.bash or set vscode-tmux.daemonPath.`);
            }
            return;
        }
        try {
            const r = (0, spawn_js_1.spawnDaemon)(bin, process.env, log);
            log(`spawned daemon: ${r.method}: ${r.command}`);
        }
        catch (err) {
            log(`failed to spawn daemon: ${err.message}`);
            return;
        }
        for (let i = 0; i < 25 && !this.disposed; i++) {
            await new Promise((r) => setTimeout(r, 200));
            if (await this.tryConnect())
                return;
        }
        log('daemon did not come up; giving up for now');
    }
    async tryConnect() {
        const client = new client_js_1.DaemonClient(SOCKET_PATH);
        try {
            await client.connect();
        }
        catch {
            return false;
        }
        this.client = client;
        client.onRequest((m) => this.handleRequest(m));
        client.onDisconnect(() => {
            log('daemon connection closed');
            if (!this.disposed)
                void this.reconnect(2000);
        });
        const hello = {
            type: 'hello',
            id: (0, node_crypto_1.randomUUID)(),
            workspaceId: this.identity.workspaceId,
            folder: this.identity.folder,
            name: this.identity.name,
            extHostPid: process.pid,
            focused: vscode.window.state.focused,
        };
        if (this.identity.workspaceFile)
            hello.workspaceFile = this.identity.workspaceFile;
        if (process.env.VSCODE_PID)
            hello.vscodePid = Number(process.env.VSCODE_PID);
        const reply = await client.request(hello);
        log(`hello reply: ${JSON.stringify(reply.data ?? reply)}`);
        return true;
    }
    async reconnect(delayMs = 500) {
        if (this.reconnecting || this.disposed)
            return;
        this.reconnecting = true;
        try {
            await new Promise((r) => setTimeout(r, delayMs));
            await this.connectWithSpawn();
        }
        finally {
            this.reconnecting = false;
        }
    }
    async handleRequest(msg) {
        if (msg.type !== 'openRequest') {
            return { type: 'result', id: msg.id ?? '', ok: false, error: `unexpected ${msg.type}` };
        }
        return this.openFile(msg);
    }
    async openFile(req) {
        try {
            const uri = vscode.Uri.file(req.path);
            const stat = await vscode.workspace.fs.stat(uri);
            let editorShort = '';
            if (stat.type & vscode.FileType.Directory) {
                // `vscode .`: bring this window forward and reveal the folder in the explorer.
                await vscode.commands.executeCommand('revealInExplorer', uri).then(undefined, () => undefined);
                editorShort = vscode.window.activeTextEditor ? (0, node_path_1.basename)(vscode.window.activeTextEditor.document.fileName) : '';
            }
            else {
                const doc = await vscode.workspace.openTextDocument(uri);
                const line = Math.max(0, (req.line ?? 1) - 1);
                const col = Math.max(0, (req.col ?? 1) - 1);
                const pos = new vscode.Position(Math.min(line, doc.lineCount - 1), col);
                const editor = await vscode.window.showTextDocument(doc, { selection: new vscode.Range(pos, pos), preview: false });
                editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
                editorShort = (0, node_path_1.basename)(doc.fileName);
            }
            const title = this.predictWindowTitle(editorShort);
            log(`opened ${req.path}${req.line ? ':' + req.line : ''}; predicted title ${JSON.stringify(title)}`);
            return { type: 'openResult', id: req.id, ok: true, title };
        }
        catch (err) {
            log(`open failed: ${err.message}`);
            return { type: 'openResult', id: req.id, ok: false, error: err.message };
        }
    }
    predictWindowTitle(activeEditorShort) {
        const cfg = vscode.workspace.getConfiguration('window');
        const template = cfg.get('title') || title_js_1.DEFAULT_TITLE_TEMPLATE;
        const separator = cfg.get('titleSeparator') || ' - ';
        const dirty = vscode.window.activeTextEditor?.document.isDirty ? '● ' : '';
        const folder = this.identity.folder;
        return (0, title_js_1.predictTitle)(template, {
            dirty,
            activeEditorShort,
            activeEditorMedium: activeEditorShort,
            activeEditorLong: activeEditorShort,
            rootName: vscode.workspace.name ?? (0, node_path_1.basename)(folder),
            rootNameShort: (0, node_path_1.basename)(folder),
            rootPath: folder,
            folderName: (0, node_path_1.basename)(folder),
            folderPath: folder,
            appName: vscode.env.appName,
            profileName: '',
            remoteName: vscode.env.remoteName ?? '',
            activeRepositoryName: '',
            activeRepositoryBranchName: '',
        }, separator);
    }
}
//# sourceMappingURL=extension.js.map