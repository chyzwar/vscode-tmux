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
    constructor(o) {
        this.o = o;
        this.code = o.codeCommand ?? 'code';
        this.log = o.log ?? (() => { });
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
        const raised = await this.raise(reply.title, workspacePath, target);
        const out = { via: 'extension', raised };
        if (reply.title !== undefined)
            out.title = reply.title;
        return out;
    }
    async raise(title, workspacePath, target) {
        if (title && (await this.o.xdotoolAvailable())) {
            const search = await this.run('xdotool', ['search', '--name', `^${escapeRegex(title)}$`]);
            const id = search.stdout.split('\n').map((s) => s.trim()).find(Boolean);
            if (id) {
                const r = await this.run('xdotool', ['windowactivate', '--sync', id]);
                if (r.code === 0)
                    return true;
            }
            this.log(`xdotool could not raise window titled ${JSON.stringify(title)}; falling back to code CLI`);
        }
        const r = await this.run(this.code, [workspacePath, '--goto', gotoArg(target)]);
        return r.code === 0;
    }
    run(cmd, args) {
        return this.o.exec(cmd, args);
    }
}
//# sourceMappingURL=opener.js.map