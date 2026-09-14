/** The client that represents the Ghostty surface: non-control, preferably xterm-ghostty. */
export function pickClient(clients) {
    const candidates = clients.filter((c) => !c.control);
    return candidates.find((c) => c.termname === 'xterm-ghostty') ?? candidates[0];
}
const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Ghostty as a single-surface container. One Ghostty instance (own class and
 * config) runs one tmux client attached to the lobby session; showing a
 * workspace is a `switch-client` on that client. tmux draws the tab bar.
 */
export class GhosttyPresenter {
    o;
    sleep;
    timeoutMs;
    pollMs;
    launching;
    constructor(o) {
        this.o = o;
        this.sleep = o.sleep ?? defaultSleep;
        this.timeoutMs = o.timeoutMs ?? 5000;
        this.pollMs = o.pollMs ?? 100;
    }
    async ensureVisible() {
        await this.client();
    }
    async show(session) {
        const client = await this.client();
        if (client.session === session)
            return;
        await this.o.backend.switchClient(client.tty, session);
    }
    /** Find the Ghostty client, launching Ghostty if there is none. Concurrent callers share one launch. */
    async client() {
        const existing = pickClient(await this.o.backend.listClients());
        if (existing)
            return existing;
        if (!this.launching) {
            this.launching = this.launch().finally(() => {
                this.launching = undefined;
            });
        }
        return this.launching;
    }
    async launch() {
        const { backend, lobbySession } = this.o;
        await backend.ensureServer();
        if (!(await backend.hasSession(lobbySession))) {
            await backend.createSession({ name: lobbySession, cwd: this.o.env.HOME ?? '/', env: {}, firstTabName: 'Shell' });
        }
        const attach = backend.attachCommand(lobbySession).join(' ');
        this.o.spawn('ghostty', [`--class=${this.o.appClass}`, '--gtk-single-instance=true', `--config-file=${this.o.configPath}`, `--command=${attach}`], this.o.env);
        const deadline = Date.now() + this.timeoutMs;
        for (;;) {
            const c = pickClient(await backend.listClients());
            if (c)
                return c;
            if (Date.now() >= deadline)
                throw new Error('no terminal client attached: Ghostty did not connect to tmux in time');
            await this.sleep(this.pollMs);
        }
    }
}
//# sourceMappingURL=ghostty.js.map