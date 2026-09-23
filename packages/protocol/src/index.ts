/**
 * Wire protocol between the VS Code extension, the `vscode` CLI and the
 * vscode-tmux daemon. Newline-delimited JSON over a Unix domain socket.
 * Requests carry an `id`; the one reply type, `result`, echoes it.
 */
import * as z from 'zod';
import { Message } from './messages.js';

export * from './messages.js';
export * from './requests.js';
export * from './rpc.js';
export { scrubEnv } from './env.js';

export function encode(msg: Message): string {
  return JSON.stringify(msg) + '\n';
}

/** Called for every line the decoder drops, with the offending line and why. */
export type InvalidLine = (line: string, reason: string) => void;

/**
 * Incremental decoder for newline-delimited JSON. Partial lines are buffered
 * until the terminating newline arrives. Every line is validated against the
 * `Message` schema: invalid JSON, unknown message types and missing fields are
 * dropped (reported through `onInvalid`), unknown keys are stripped.
 */
export class NdjsonDecoder {
  private buffer = '';

  constructor(private readonly onInvalid?: InvalidLine) {}

  push(chunk: Buffer | string): Message[] {
    this.buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const out: Message[] = [];
    let nl: number;
    while ((nl = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, nl);
      this.buffer = this.buffer.slice(nl + 1);
      const msg = parseLine(line, this.onInvalid);
      if (msg) out.push(msg);
    }
    return out;
  }
}

function parseLine(line: string, onInvalid?: InvalidLine): Message | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    onInvalid?.(trimmed, 'invalid JSON');
    return undefined;
  }
  const r = Message.safeParse(value);
  if (r.success) return r.data;
  onInvalid?.(trimmed, z.prettifyError(r.error));
  return undefined;
}
