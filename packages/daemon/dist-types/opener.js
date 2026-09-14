import { randomUUID } from 'node:crypto';
import { parseTarget } from './target.js';
export function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const gotoArg = (t) => t.path + (t.line !== undefined ? `:${t.line}` + (t.col !== undefined ? `:${t.col}` : '') : '');
/**
 * Routes "open this file" requests from terminals to the right VS Code window:
 * via the connected extension when the window is open (exact window, then raise
 * it with xdotool since VS Code runs under XWayland), otherwise via `code <folder> --goto`.
 */
export class Opener {
    o;
    code;
    log;
    sleep;
    titleAttempts;
    titleRetryMs;
    constructor(o) {
        this.o = o;
        this.code = o.codeCommand ?? 'code';
        this.log = o.log ?? (() => { });
        this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
        this.titleAttempts = o.titleAttempts ?? 8;
        this.titleRetryMs = o.titleRetryMs ?? 125;
    }
    async open(input) {
        const target = parseTarget(input.target, input.cwd);
        const record = input.workspaceId ? this.o.registry.get(input.workspaceId) : undefined;
        if (!record) {
            await this.run(this.code, ['--goto', gotoArg(target)]);
            return { via: 'code-cli-fallback' };
        }
        const conn = this.o.registry.connection(record.workspaceId);
        const workspacePath = record.workspaceFile ?? record.folder;
        if (!conn) {
            await this.run(this.code, [workspacePath, '--goto', gotoArg(target)]);
            return { via: 'code-cli' };
        }
        const req = { type: 'openRequest', id: randomUUID(), path: target.path };
        if (target.line !== undefined)
            req.line = target.line;
        if (target.col !== undefined)
            req.col = target.col;
        const reply = (await conn.request(req, 10_000));
        if (!reply.ok)
            throw new Error(reply.error ?? 'extension failed to open the file');
        const raised = await this.raise(reply.title, workspacePath, target, record.name);
        this.log(`opened ${gotoArg(target)} in ${record.name} via extension; raised=${raised}`);
        const out = { via: 'extension', raised };
        if (reply.title !== undefined)
            out.title = reply.title;
        return out;
    }
    async raise(title, workspacePath, target, workspaceName) {
        if (title && (await this.o.xdotoolAvailable())) {
            const id = (await this.findWindow(title, workspaceName)) ?? undefined;
            if (id && (await this.activate(id)))
                return true;
            this.log(`xdotool could not raise window titled ${JSON.stringify(title)}; falling back to code CLI`);
        }
        const r = await this.run(this.code, [workspacePath, '--goto', gotoArg(target)]);
        return r.code === 0;
    }
    /**
     * Find the X11 window of the target VS Code window. The exact title is tried
     * a few times because VS Code renames the window shortly after the editor
     * opens; then a match on " - <workspace name> - " is accepted if unambiguous.
     */
    async findWindow(title, workspaceName) {
        for (let attempt = 0; attempt < this.titleAttempts; attempt++) {
            const ids = await this.search(`^${escapeRegex(title)}$`);
            if (ids.length >= 1)
                return ids[0];
            await this.sleep(this.titleRetryMs);
        }
        const loose = await this.search(` - ${escapeRegex(workspaceName)} - `);
        if (loose.length === 1)
            return loose[0];
        if (loose.length > 1)
            this.log(`ambiguous window match for workspace ${workspaceName}: ${loose.join(', ')}`);
        return undefined;
    }
    /**
     * Bring an X11 window to the front. `windowactivate` (_NET_ACTIVE_WINDOW) is
     * subject to Mutter's focus-stealing prevention and is often ignored, while a
     * direct raise + XSetInputFocus between XWayland windows is honored; do both
     * and verify with getactivewindow.
     */
    async activate(id) {
        await this.run('xdotool', ['windowactivate', id]);
        await this.run('xdotool', ['windowraise', id]);
        await this.run('xdotool', ['windowfocus', '--sync', id]);
        const active = await this.run('xdotool', ['getactivewindow']);
        const ok = active.code === 0 && Number(active.stdout.trim()) === Number(id);
        if (!ok)
            this.log(`window ${id} did not become active (active=${active.stdout.trim() || 'unknown'})`);
        return ok;
    }
    async search(pattern) {
        const r = await this.run('xdotool', ['search', '--name', pattern]);
        return r.stdout
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);
    }
    run(cmd, args) {
        return this.o.exec(cmd, args);
    }
}
//# sourceMappingURL=opener.js.map