import * as z from 'zod';
import { Client, OpenOutcome, Tab, WorkspaceRecord, type Message } from './messages.js';

/**
 * Request/reply pairing. A request is any message that carries an `id` and is
 * not itself a reply; the tables below give the shape of the `data` a `result`
 * to it carries. Request shapes live in the `Message` union, so only the result
 * side is declared here.
 */

/** Every message that carries an id and is not itself a reply. */
export type RequestType = Exclude<Extract<Message, { id: string }>['type'], 'result'>;
export type RequestOf<T extends RequestType> = Extract<Message, { type: T }>;
/** What a caller supplies: the request minus `type` and `id`, which the requester adds. */
export type RequestBody<T extends RequestType> = Omit<RequestOf<T>, 'type' | 'id'>;

/** Requests the daemon answers (sent by the extension and the CLI). */
export const daemonResults = {
  hello: z.object({ sessionName: z.string(), created: z.boolean() }),
  createTerminal: z.object({ tab: Tab }),
  showSession: z.object({ sessionName: z.string() }),
  open: OpenOutcome,
  list: z.object({ workspaces: z.array(WorkspaceRecord.extend({ connected: z.boolean(), tabs: z.array(Tab) })) }),
  status: z.object({
    socket: z.string(),
    stateFile: z.string(),
    pid: z.number(),
    runtime: z.string(),
    sessions: z.array(z.string()),
    clients: z.array(Client),
    connected: z.array(z.string()),
  }),
} satisfies Partial<Record<RequestType, z.ZodType>>;

/** Requests the extension answers (sent by the daemon). */
export const extensionResults = {
  openRequest: z.object({ title: z.string().optional() }),
  windowStateRequest: z.object({ focused: z.boolean() }),
} satisfies Partial<Record<RequestType, z.ZodType>>;

/** Fails to compile when a request type has no result schema, or a key is not a request type. */
export const results = { ...daemonResults, ...extensionResults } satisfies Record<RequestType, z.ZodType>;

export type DaemonRequestType = keyof typeof daemonResults;
export type ExtensionRequestType = keyof typeof extensionResults;
export type ResultOf<T extends RequestType> = z.output<(typeof results)[T]>;

/** What a request resolves to: transport failures reject instead. */
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
