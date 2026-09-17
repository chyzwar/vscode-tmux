/**
 * Wire protocol between the VS Code extension, the `vscode` CLI and the
 * vscode-tmux daemon. Newline-delimited JSON over a Unix domain socket.
 * Requests carry an `id`; replies (`result`, `openResult`) echo it.
 */

export type WorkspaceId = string;

export interface HelloMessage {
  type: 'hello';
  id: string;
  workspaceId: WorkspaceId;
  /** Absolute path of the (first) workspace folder. */
  folder: string;
  /** Absolute path of the .code-workspace file, if any. */
  workspaceFile?: string;
  /** Human-readable workspace name (folder basename or workspace name). */
  name: string;
  extHostPid: number;
  vscodePid?: number;
  focused: boolean;
}

export interface FocusMessage {
  type: 'focus';
  workspaceId: WorkspaceId;
  focused: boolean;
}

export interface CreateTerminalMessage {
  type: 'createTerminal';
  id: string;
  workspaceId: WorkspaceId;
  name?: string;
  cwd?: string;
  command?: string[];
}

export interface ShowSessionMessage {
  type: 'showSession';
  id: string;
  workspaceId: WorkspaceId;
}

/** Sent by the `vscode` CLI from inside a terminal. */
export interface OpenMessage {
  type: 'open';
  id: string;
  workspaceId?: WorkspaceId;
  cwd: string;
  /** `path[:line[:col]]` or `.` */
  target: string;
}

export interface ListMessage {
  type: 'list';
  id: string;
}

export interface StatusMessage {
  type: 'status';
  id: string;
}

/** Daemon → extension: open this file in your window. */
export interface OpenRequestMessage {
  type: 'openRequest';
  id: string;
  path: string;
  line?: number;
  col?: number;
}

/** Extension → daemon: reply to `openRequest`. */
export interface OpenResultMessage {
  type: 'openResult';
  id: string;
  ok: boolean;
  /** Predicted OS window title after the editor was shown (used to raise the window). */
  title?: string;
  error?: string;
}

/** Daemon → extension: does your window have OS focus right now? Answered with a `result` whose data is `{ focused: boolean }`. */
export interface WindowStateRequestMessage {
  type: 'windowStateRequest';
  id: string;
}

export interface ResultMessage {
  type: 'result';
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type Message =
  | HelloMessage
  | FocusMessage
  | CreateTerminalMessage
  | ShowSessionMessage
  | OpenMessage
  | ListMessage
  | StatusMessage
  | OpenRequestMessage
  | OpenResultMessage
  | WindowStateRequestMessage
  | ResultMessage;

export type MessageType = Message['type'];

export function encode(msg: Message): string {
  return JSON.stringify(msg) + '\n';
}

/**
 * Incremental decoder for newline-delimited JSON. Partial lines are buffered
 * until the terminating newline arrives. Lines that are not valid JSON objects
 * with a string `type` are dropped.
 */
export class NdjsonDecoder {
  private buffer = '';

  push(chunk: Buffer | string): Message[] {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const out: Message[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const msg = parseLine(line);
      if (msg) out.push(msg);
    }
    return out;
  }
}

function parseLine(line: string): Message | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const rec = value as Record<string, unknown>;
      if (typeof rec.type === 'string') return value as Message;
    }
  } catch {
    // malformed line: skip
  }
  return undefined;
}

export { scrubEnv } from './env.js';
