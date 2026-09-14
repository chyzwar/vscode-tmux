/**
 * Field separator for `-F` output. Must be printable ASCII: tmux replaces
 * non-printable characters (including tabs) with `_` when the locale is C.
 */
export const SEP = '<|>';
const TAB_FORMAT = ['#{window_id}', '#{window_index}', '#{window_name}', '#{window_active}', '#{pane_current_path}', '#{pane_current_command}'].join(SEP);
const CLIENT_FORMAT = ['#{client_tty}', '#{client_termname}', '#{client_control_mode}', '#{client_session}', '#{client_pid}'].join(SEP);
export class TmuxBackend {
    o;
    constructor(o) {
        this.o = o;
    }
    base(withConfig = false) {
        const a = ['-L', this.o.socketName];
        if (withConfig)
            a.push('-f', this.o.configPath);
        return a;
    }
    async run(args, withConfig = false) {
        return this.o.exec('tmux', [...this.base(withConfig), ...args], { env: this.o.env });
    }
    async must(args, withConfig = false) {
        const r = await this.run(args, withConfig);
        if (r.code !== 0)
            throw new Error(`tmux ${args[0]} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
        return r.stdout;
    }
    async ensureServer() {
        await this.must(['start-server'], true);
    }
    async hasSession(name) {
        const r = await this.run(['has-session', '-t', `=${name}`]);
        return r.code === 0;
    }
    async createSession(o) {
        const args = ['new-session', '-d', '-s', o.name, '-n', o.firstTabName, '-c', o.cwd];
        for (const [k, v] of Object.entries(o.env))
            args.push('-e', `${k}=${v}`);
        await this.must(args, true);
    }
    async listSessions() {
        const r = await this.run(['list-sessions', '-F', '#{session_name}']);
        if (r.code !== 0)
            return [];
        return r.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
    }
    async listTabs(session) {
        const out = await this.must(['list-windows', '-t', `=${session}`, '-F', TAB_FORMAT]);
        return out
            .split('\n')
            .filter((l) => l.trim())
            .map((line) => {
            const [id = '', index = '0', name = '', active = '0', cwd = '', command = ''] = line.split(SEP);
            return { id, index: Number(index), name, cwd, active: active === '1', command };
        });
    }
    async newTab(session, o) {
        const args = ['new-window', '-t', `=${session}:`, '-n', o.name, '-c', o.cwd, '-P', '-F', '#{window_id}'];
        if (o.command && o.command.length > 0)
            args.push(...o.command);
        const id = (await this.must(args)).trim();
        const tabs = await this.listTabs(session);
        const tab = tabs.find((t) => t.id === id);
        if (!tab)
            throw new Error(`tmux created window ${id} but it is not listed in session ${session}`);
        return tab;
    }
    async selectTab(session, tabId) {
        await this.must(['select-window', '-t', `=${session}:${tabId}`]);
    }
    async listClients() {
        const r = await this.run(['list-clients', '-F', CLIENT_FORMAT]);
        if (r.code !== 0)
            return [];
        return r.stdout
            .split('\n')
            .filter((l) => l.trim())
            .map((line) => {
            const [tty = '', termname = '', control = '0', session = '', pid = '0'] = line.split(SEP);
            return { tty, termname, control: control === '1', session, pid: Number(pid) };
        });
    }
    async switchClient(tty, session) {
        await this.must(['switch-client', '-E', '-c', tty, '-t', `=${session}`]);
    }
    attachCommand(session) {
        return ['tmux', ...this.base(true), 'new-session', '-A', '-s', session];
    }
}
//# sourceMappingURL=tmux.js.map