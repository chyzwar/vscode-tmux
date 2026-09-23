import * as z from 'zod';

/**
 * Wire messages. Each schema is the single source of truth for its shape: the
 * decoder validates incoming lines against `Message`, and the TypeScript types
 * are inferred from the same schemas.
 */

export type WorkspaceId = string;

// --- payload shapes shared by several messages --------------------------------

/** One tmux window of a workspace session. */
export const Tab = z.object({
  id: z.string(),
  index: z.number(),
  name: z.string(),
  cwd: z.string(),
  active: z.boolean(),
  command: z.string(),
});
export type Tab = z.infer<typeof Tab>;

/** One attached tmux client. */
export const Client = z.object({
  tty: z.string(),
  termname: z.string(),
  control: z.boolean(),
  session: z.string(),
  pid: z.number(),
});
export type Client = z.infer<typeof Client>;

export const WorkspaceRecord = z.object({
  workspaceId: z.string(),
  /** Absolute path of the (first) workspace folder. */
  folder: z.string(),
  /** Absolute path of the .code-workspace file, if any. */
  workspaceFile: z.string().optional(),
  /** Human-readable workspace name (folder basename or workspace name). */
  name: z.string(),
  sessionName: z.string(),
});
export type WorkspaceRecord = z.infer<typeof WorkspaceRecord>;

/** How an `open` request was carried out. */
export const OpenOutcome = z.object({
  via: z.enum(['extension', 'code-cli', 'code-cli-fallback']),
  /** Predicted OS window title after the editor was shown (used to raise the window). */
  title: z.string().optional(),
  raised: z.boolean().optional(),
});
export type OpenOutcome = z.infer<typeof OpenOutcome>;

// --- messages ------------------------------------------------------------------

const id = z.string().min(1);

/** Extension → daemon, once per connection. */
export const HelloMessage = z.object({
  type: z.literal('hello'),
  id,
  workspaceId: z.string(),
  folder: z.string(),
  workspaceFile: z.string().optional(),
  name: z.string(),
  extHostPid: z.number(),
  vscodePid: z.number().optional(),
  focused: z.boolean(),
});
export type HelloMessage = z.infer<typeof HelloMessage>;

/** Extension → daemon, fire-and-forget: the window gained or lost OS focus. */
export const FocusMessage = z.object({
  type: z.literal('focus'),
  workspaceId: z.string(),
  focused: z.boolean(),
});
export type FocusMessage = z.infer<typeof FocusMessage>;

export const CreateTerminalMessage = z.object({
  type: z.literal('createTerminal'),
  id,
  workspaceId: z.string(),
  name: z.string().optional(),
  cwd: z.string().optional(),
  command: z.array(z.string()).optional(),
});
export type CreateTerminalMessage = z.infer<typeof CreateTerminalMessage>;

export const ShowSessionMessage = z.object({
  type: z.literal('showSession'),
  id,
  workspaceId: z.string(),
});
export type ShowSessionMessage = z.infer<typeof ShowSessionMessage>;

/** Sent by the `vscode` CLI from inside a terminal, and by the click handler. */
export const OpenMessage = z.object({
  type: z.literal('open'),
  id,
  workspaceId: z.string().optional(),
  /**
   * The tmux session the request came from, used when there is no workspace id.
   * A mouse click is delivered by tmux, which knows the session but not the
   * environment of the shell inside it.
   */
  sessionName: z.string().optional(),
  cwd: z.string(),
  /** `path[:line[:col]]` or `.` */
  target: z.string(),
});
export type OpenMessage = z.infer<typeof OpenMessage>;

export const ListMessage = z.object({ type: z.literal('list'), id });
export type ListMessage = z.infer<typeof ListMessage>;

export const StatusMessage = z.object({ type: z.literal('status'), id });
export type StatusMessage = z.infer<typeof StatusMessage>;

/** Daemon → extension: open this file in your window. Answered with a `result` whose data is `{ title? }`. */
export const OpenRequestMessage = z.object({
  type: z.literal('openRequest'),
  id,
  path: z.string(),
  line: z.number().optional(),
  col: z.number().optional(),
});
export type OpenRequestMessage = z.infer<typeof OpenRequestMessage>;

/** Daemon → extension: does your window have OS focus right now? Answered with a `result` whose data is `{ focused }`. */
export const WindowStateRequestMessage = z.object({ type: z.literal('windowStateRequest'), id });
export type WindowStateRequestMessage = z.infer<typeof WindowStateRequestMessage>;

/** The one reply shape. `data` is validated per request type by the requester (see requests.ts). */
export const ResultMessage = z.object({
  type: z.literal('result'),
  id,
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: z.string().optional(),
});
export type ResultMessage = z.infer<typeof ResultMessage>;

export const Message = z.discriminatedUnion('type', [
  HelloMessage,
  FocusMessage,
  CreateTerminalMessage,
  ShowSessionMessage,
  OpenMessage,
  ListMessage,
  StatusMessage,
  OpenRequestMessage,
  WindowStateRequestMessage,
  ResultMessage,
]);
export type Message = z.infer<typeof Message>;

export type MessageType = Message['type'];
