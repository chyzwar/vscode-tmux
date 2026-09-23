import { randomUUID } from 'node:crypto';
import * as z from 'zod';
import type { Message, ResultMessage } from './messages.js';
import { results, type Reply, type RequestBody, type RequestOf, type RequestType, type ResultOf } from './requests.js';

/**
 * The request side of the protocol, shared by every peer: the daemon's socket
 * connection and the extension's client both feed inbound messages through
 * `settle` and send requests through `request`.
 */

type Pending = { resolve: (m: ResultMessage) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/** Typed success reply for a handler: `T` is inferred from `req.type`, so `data` is checked against that request's result schema. */
export function okResult<T extends RequestType>(req: { type: T; id: string }, data: ResultOf<T>): ResultMessage {
  return { type: 'result', id: req.id, ok: true, data };
}

export const errorResult = (id: string, error: string): ResultMessage => ({ type: 'result', id, ok: false, error });

/** Turn a raw wire reply into a typed `Reply`. A payload that fails the result schema is an error, not an exception. */
export function decodeReply<T extends RequestType>(type: T, raw: ResultMessage): Reply<ResultOf<T>> {
  if (!raw.ok) return { ok: false, error: raw.error ?? `${type} failed` };
  // TS cannot correlate results[T] with ResultOf<T> for a generic T; the table is checked against RequestType at its definition.
  const schema = results[type] as unknown as z.ZodType<ResultOf<T>>;
  const parsed = schema.safeParse(raw.data);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, error: `malformed reply to ${type}: ${z.prettifyError(parsed.error)}` };
}

/** Outstanding requests of one connection: ids, timeouts, and matching `result` messages to them. */
export class PendingRequests {
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly send: (msg: Message) => void,
    private readonly newId: () => string = randomUUID,
  ) {}

  request<T extends RequestType>(type: T, body: RequestBody<T>, timeoutMs: number): Promise<Reply<ResultOf<T>>> {
    const id = this.newId();
    // The spread of a generic body is opaque to TS; the caller's `body` was checked against RequestBody<T>.
    const msg = { ...body, type, id } as unknown as RequestOf<T>;
    return new Promise<ResultMessage>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`timeout waiting for reply to ${type}`));
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send(msg);
    }).then((raw) => decodeReply(type, raw));
  }

  /** Feed every inbound message here first; true when it was the reply to a request still waiting. */
  settle(msg: Message): boolean {
    if (msg.type !== 'result') return false;
    const p = this.pending.get(msg.id);
    if (!p) return false; // a late reply after its timeout, or not ours
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    p.resolve(msg);
    return true;
  }

  get size(): number {
    return this.pending.size;
  }

  rejectAll(reason: string): void {
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }
}
