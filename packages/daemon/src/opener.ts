import { randomUUID } from 'node:crypto';
import type { Message, OpenResultMessage, ResultMessage } from '@vscode-tmux/protocol';
import type { Exec } from './exec.js';
import type { WindowRaiser } from './raise/types.js';
import type { Connection, Registry } from './registry.js';
import { parseTarget, type Target } from './target.js';

export type { WindowRaiser } from './raise/types.js';

export interface OpenerOptions {
  registry: Registry;
  exec: Exec;
  codeCommand?: string;
  /** The desktop's window raiser (see raise/index.ts), or undefined when there is none. Called per open. */
  raiser: () => Promise<WindowRaiser | undefined>;
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

const gotoArg = (t: Target): string => t.path + (t.line !== undefined ? `:${t.line}` + (t.col !== undefined ? `:${t.col}` : '') : '');

/**
 * Routes "open this file" requests from terminals to the right VS Code window:
 * via the connected extension when the window is open (exact window, then raise it
 * through the desktop's raiser), otherwise via `code <folder> --goto`.
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

    const raised = await this.raise(reply.title, workspacePath, target, record.name, conn);
    this.log(`opened ${gotoArg(target)} in ${record.name} via extension; raised=${raised}`);
    const out: OpenOutcome = { via: 'extension', raised };
    if (reply.title !== undefined) out.title = reply.title;
    return out;
  }

  private async raise(title: string | undefined, workspacePath: string, target: Target, workspaceName: string, conn: Connection): Promise<boolean> {
    const raiser = title ? await this.o.raiser() : undefined;
    if (title && raiser) {
      if (await raiser.raise(title, workspaceName, () => this.isFocused(conn))) return true;
      this.log(`could not raise window titled ${JSON.stringify(title)}; falling back to code CLI`);
    }
    const r = await this.run(this.code, [workspacePath, '--goto', gotoArg(target)]);
    return r.code === 0;
  }

  /** Ask the window's extension host whether the window has OS focus now. */
  private async isFocused(conn: Connection): Promise<boolean> {
    try {
      const reply = (await conn.request({ type: 'windowStateRequest', id: randomUUID() }, 2000)) as ResultMessage;
      return reply.ok && (reply.data as { focused?: unknown } | undefined)?.focused === true;
    } catch {
      return false;
    }
  }

  private run(cmd: string, args: string[]) {
    return this.o.exec(cmd, args);
  }
}
