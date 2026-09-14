import { randomUUID } from 'node:crypto';
import type { Message, OpenResultMessage } from '@vscode-tmux/protocol';
import type { Exec } from './exec.js';
import type { Registry } from './registry.js';
import { parseTarget, type Target } from './target.js';

export interface OpenerOptions {
  registry: Registry;
  exec: Exec;
  codeCommand?: string;
  xdotoolAvailable: () => Promise<boolean>;
  log?: (line: string) => void;
}

export interface OpenInput {
  workspaceId?: string;
  cwd: string;
  target: string;
}

export interface OpenOutcome {
  via: 'extension' | 'code-cli' | 'code-cli-fallback';
  title?: string;
  raised?: boolean;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const gotoArg = (t: Target): string => t.path + (t.line !== undefined ? `:${t.line}` + (t.col !== undefined ? `:${t.col}` : '') : '');

/**
 * Routes "open this file" requests from terminals to the right VS Code window:
 * via the connected extension when the window is open (exact window, then raise
 * it with xdotool since VS Code runs under XWayland), otherwise via `code <folder> --goto`.
 */
export class Opener {
  private readonly code: string;
  private readonly log: (line: string) => void;

  constructor(private readonly o: OpenerOptions) {
    this.code = o.codeCommand ?? 'code';
    this.log = o.log ?? (() => {});
  }

  async open(input: OpenInput): Promise<OpenOutcome> {
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

    const req: Message = { type: 'openRequest', id: randomUUID(), path: target.path };
    if (target.line !== undefined) req.line = target.line;
    if (target.col !== undefined) req.col = target.col;
    const reply = (await conn.request(req, 10_000)) as OpenResultMessage;
    if (!reply.ok) throw new Error(reply.error ?? 'extension failed to open the file');

    const raised = await this.raise(reply.title, workspacePath, target);
    const out: OpenOutcome = { via: 'extension', raised };
    if (reply.title !== undefined) out.title = reply.title;
    return out;
  }

  private async raise(title: string | undefined, workspacePath: string, target: Target): Promise<boolean> {
    if (title && (await this.o.xdotoolAvailable())) {
      const search = await this.run('xdotool', ['search', '--name', `^${escapeRegex(title)}$`]);
      const id = search.stdout.split('\n').map((s) => s.trim()).find(Boolean);
      if (id) {
        const r = await this.run('xdotool', ['windowactivate', '--sync', id]);
        if (r.code === 0) return true;
      }
      this.log(`xdotool could not raise window titled ${JSON.stringify(title)}; falling back to code CLI`);
    }
    const r = await this.run(this.code, [workspacePath, '--goto', gotoArg(target)]);
    return r.code === 0;
  }

  private run(cmd: string, args: string[]) {
    return this.o.exec(cmd, args);
  }
}
