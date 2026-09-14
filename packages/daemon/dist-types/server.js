import { sessionNameFor } from './ids.js';
import { Registry } from './registry.js';
import { loadState, saveState } from './state.js';
/**
 * Message dispatcher for the daemon. Transport-agnostic: `handle()` receives
 * decoded messages from any connection; replies go back through `conn.send`.
 */
export class DaemonServer {
    o;
    registry;
    state;
    pendingShow;
    showQueue = Promise.resolve();
    focusDebounceMs;
    constructor(o) {
        this.o = o;
        this.registry = o.registry ?? new Registry();
        this.state = loadState(o.stateFile);
        this.focusDebounceMs = o.focusDebounceMs ?? 50;
        for (const [id, ws] of Object.entries(this.state.workspaces)) {
            this.registry.upsert({ workspaceId: id, folder: ws.folder, workspaceFile: ws.workspaceFile, name: ws.name, sessionName: ws.sessionName });
        }
    }
    async handle(conn, msg) {
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
                    // replies are routed by the transport layer (SocketConnection); nothing to do here
                    return;
                default: {
                    const unknown = msg;
                    if (unknown.id)
                        this.replyError(conn, unknown.id, `unknown message type ${unknown.type}`);
                    return;
                }
            }
        }
        catch (err) {
            const id = msg.id;
            this.o.log(`error handling ${msg.type}: ${err.stack ?? err}`);
            if (id)
                this.replyError(conn, id, err.message);
        }
    }
    /** Called by the transport when a peer goes away. */
    disconnected(conn) {
        for (const id of this.registry.detach(conn))
            this.o.log(`workspace ${id} disconnected`);
    }
    /** Wait for any debounced presenter work (tests). */
    async flush() {
        if (this.pendingShow) {
            clearTimeout(this.pendingShow.timer);
            const { workspaceId } = this.pendingShow;
            this.pendingShow = undefined;
            this.enqueueShow(workspaceId);
        }
        await this.showQueue;
    }
    require(workspaceId) {
        const rec = this.registry.get(workspaceId);
        if (!rec)
            throw new Error(`unknown workspace ${workspaceId}; is the VS Code Tmux extension connected?`);
        return rec;
    }
    async onHello(conn, msg) {
        const sessionName = sessionNameFor(msg.workspaceFile ?? msg.folder, msg.workspaceId);
        const record = { workspaceId: msg.workspaceId, folder: msg.folder, workspaceFile: msg.workspaceFile, name: msg.name, sessionName };
        this.registry.upsert(record);
        this.registry.attach(msg.workspaceId, conn);
        const created = await this.ensureSession(record);
        this.o.log(`${created ? 'created' : 'reattached'} session ${sessionName} for ${msg.folder}`);
        await this.snapshot(msg.workspaceId);
        this.reply(conn, msg.id, { sessionName, created });
        if (msg.focused)
            this.scheduleShow(msg.workspaceId, 0);
    }
    /** Make sure the workspace's tmux session exists (it may have been killed behind our back). */
    async ensureSession(rec) {
        await this.o.backend.ensureServer();
        if (await this.o.backend.hasSession(rec.sessionName))
            return false;
        await this.o.backend.createSession({ name: rec.sessionName, cwd: rec.folder, env: this.o.sessionEnv(rec.workspaceId, rec.folder), firstTabName: 'Shell' });
        return true;
    }
    onFocus(workspaceId, focused) {
        if (!focused)
            return;
        const rec = this.registry.get(workspaceId);
        if (!rec) {
            this.o.log(`focus for unknown workspace ${workspaceId}`);
            return;
        }
        this.scheduleShow(workspaceId, this.focusDebounceMs);
    }
    scheduleShow(workspaceId, delayMs) {
        if (this.pendingShow)
            clearTimeout(this.pendingShow.timer);
        const timer = setTimeout(() => {
            this.pendingShow = undefined;
            this.enqueueShow(workspaceId);
        }, delayMs);
        timer.unref();
        this.pendingShow = { workspaceId, timer };
    }
    enqueueShow(workspaceId) {
        this.showQueue = this.showQueue
            .then(async () => {
            const rec = this.require(workspaceId);
            if (await this.ensureSession(rec))
                this.o.log(`recreated missing session ${rec.sessionName}`);
            await this.o.presenter.show(rec.sessionName);
        })
            .catch((err) => this.o.log(`show(${workspaceId}) failed: ${err.message}`));
    }
    async onCreateTerminal(conn, msg) {
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
    async onOpen(conn, msg) {
        const input = { cwd: msg.cwd, target: msg.target };
        if (msg.workspaceId)
            input.workspaceId = msg.workspaceId;
        const outcome = await this.o.opener.open(input);
        this.reply(conn, msg.id, outcome);
    }
    async list() {
        const workspaces = [];
        for (const rec of this.registry.all()) {
            const tabs = (await this.o.backend.hasSession(rec.sessionName)) ? await this.o.backend.listTabs(rec.sessionName) : [];
            workspaces.push({ ...rec, connected: this.registry.connection(rec.workspaceId) !== undefined, tabs });
        }
        return { workspaces };
    }
    async status() {
        const sessions = await this.o.backend.listSessions();
        const clients = await this.o.backend.listClients();
        return { socket: this.o.socketPath, stateFile: this.o.stateFile, sessions, clients, connected: this.registry.connectedIds() };
    }
    /** Persist the current tabs of a workspace (names, cwd, and the start command when we know it). */
    async snapshot(workspaceId, started) {
        const rec = this.require(workspaceId);
        const tabs = await this.o.backend.listTabs(rec.sessionName);
        const previous = this.state.workspaces[workspaceId]?.tabs ?? [];
        const commandFor = (name) => (started && started.name === name ? started.command : previous.find((t) => t.name === name)?.command);
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
    reply(conn, id, data) {
        const msg = { type: 'result', id, ok: true, data };
        conn.send(msg);
    }
    replyError(conn, id, error) {
        const msg = { type: 'result', id, ok: false, error };
        conn.send(msg);
    }
}
//# sourceMappingURL=server.js.map