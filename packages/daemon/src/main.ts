import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Message, ResultMessage } from '@vscode-tmux/protocol';
import { resolve } from 'node:path';
import { runDaemon } from './daemon.js';
import { realExec } from './exec.js';
import { computeWorkspaceId } from './ids.js';
import { GHOSTTY_CLASS, GHOSTTY_UNIT, socketPath } from './paths.js';
import { findQuakeShortcut, toggleQuake } from './quake.js';
import { parseClickTarget } from './target.js';
import { tryConnect } from './transport.js';

const USAGE = `vscode-tmux — VS Code ⇄ Ghostty/tmux companion

Usage:
  vscode-tmux daemon [--foreground]   run the daemon (normally auto-started by the extension)
  vscode-tmux open <target>           open path[:line[:col]] in this terminal's VS Code window
  vscode-tmux new [name] [-- cmd...]  create a terminal tab in this terminal's workspace
  vscode-tmux show [path]             show the session of the workspace at path (default: cwd) in Ghostty
  vscode-tmux toggle                  pull the Ghostty dropdown down / up (same as ctrl+\`)
  vscode-tmux click --session=S --cwd=D --word=W [--link=U] [--keep]
                                      open what was clicked in a tab (bound to the mouse in tmux.conf)
  vscode-tmux list                    list workspaces, sessions and tabs
  vscode-tmux status                  daemon / tmux / Ghostty status

The \`vscode\` command is an alias for \`vscode-tmux open\`.
`;

async function request(msg: Message): Promise<ResultMessage> {
  const conn = await tryConnect(socketPath());
  if (!conn) throw new Error(`daemon not running (no socket at ${socketPath()})`);
  try {
    return (await conn.request(msg, 15_000)) as ResultMessage;
  } finally {
    conn.close();
  }
}

function fail(message: string, code = 1): never {
  process.stderr.write(`vscode-tmux: ${message}\n`);
  process.exit(code);
}

async function open(args: string[]): Promise<void> {
  const target = args[0] ?? '.';
  const workspaceId = process.env.VSCODE_TMUX_WORKSPACE_ID;
  const cwd = process.cwd();
  let conn;
  try {
    conn = await tryConnect(socketPath());
  } catch {
    conn = undefined;
  }
  if (!conn) {
    // No daemon: best effort through the code CLI (last active window).
    process.stderr.write('vscode-tmux: daemon not running; using `code --goto` (last active window)\n');
    const child = spawn('code', ['--goto', target], { stdio: 'inherit' });
    child.on('exit', (c) => process.exit(c ?? 1));
    return;
  }
  try {
    const msg: Message = { type: 'open', id: randomUUID(), cwd, target };
    if (workspaceId) msg.workspaceId = workspaceId;
    else process.stderr.write('vscode-tmux: VSCODE_TMUX_WORKSPACE_ID not set; opening in the last active window\n');
    const reply = (await conn.request(msg, 15_000)) as ResultMessage;
    if (!reply.ok) fail(reply.error ?? 'open failed');
    const d = reply.data as { via: string; raised?: boolean };
    if (d.via === 'extension' && d.raised === false) process.stderr.write('vscode-tmux: opened, but the window could not be raised\n');
  } finally {
    conn.close();
  }
}

async function newTab(args: string[]): Promise<void> {
  const workspaceId = process.env.VSCODE_TMUX_WORKSPACE_ID;
  if (!workspaceId) fail('VSCODE_TMUX_WORKSPACE_ID not set; run this inside a vscode-tmux terminal');
  const dash = args.indexOf('--');
  const name = (dash === -1 ? args : args.slice(0, dash)).join(' ').trim();
  const command = dash === -1 ? undefined : args.slice(dash + 1);
  const msg: Message = { type: 'createTerminal', id: randomUUID(), workspaceId, cwd: process.cwd() };
  if (name) msg.name = name;
  if (command && command.length) msg.command = command;
  const reply = await request(msg);
  if (!reply.ok) fail(reply.error ?? 'createTerminal failed');
}

async function show(args: string[]): Promise<void> {
  const workspaceId = args[0] ? await computeWorkspaceId(resolve(args[0])) : (process.env.VSCODE_TMUX_WORKSPACE_ID ?? (await computeWorkspaceId(process.cwd())));
  const reply = await request({ type: 'showSession', id: randomUUID(), workspaceId });
  if (!reply.ok) fail(reply.error ?? 'showSession failed');
  process.stdout.write(`showing ${(reply.data as { sessionName: string }).sessionName}\n`);
}

/**
 * Press the dropdown's global shortcut through kglobalaccel. Ghostty has no IPC
 * for `toggle_quick_terminal`, so this only works where the desktop registered
 * the `global:` keybind for us (Plasma).
 */
/**
 * Open the file the user clicked on in a terminal tab.
 *
 * tmux runs this from a mouse binding, so it hands us the session (not the
 * workspace: the binding runs outside the shell and never sees its environment),
 * the pane's directory, the word under the pointer and the OSC 8 link if the
 * program emitted one. Anything that is not an existing file is silently
 * ignored — a click on prose must do nothing.
 */
async function click(args: string[]): Promise<void> {
  const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
  const cwd = flag('cwd') || process.cwd();
  const target = parseClickTarget(flag('word'), flag('link'), cwd);
  if (!target) return;

  const msg: Message = { type: 'open', id: randomUUID(), cwd, target: gotoArg(target) };
  const session = flag('session');
  if (session) msg.sessionName = session;
  const reply = await request(msg);
  if (!reply.ok) fail(reply.error ?? 'open failed');
  // The dropdown covers the editor it just raised, so get out of the way.
  if (!args.includes('--keep')) await toggleQuake(realExec, GHOSTTY_CLASS).catch(() => undefined);
}

const gotoArg = (t: { path: string; line?: number; col?: number }): string =>
  t.path + (t.line !== undefined ? `:${t.line}` + (t.col !== undefined ? `:${t.col}` : '') : '');

async function toggle(): Promise<void> {
  const found = await toggleQuake(realExec, GHOSTTY_CLASS);
  if (found) {
    process.stdout.write(`toggled ${found.action}\n`);
    return;
  }
  const active = (await realExec('systemctl', ['--user', 'is-active', GHOSTTY_UNIT])).stdout.trim() || 'unknown';
  fail(
    `no global shortcut registered for ${GHOSTTY_CLASS} (${GHOSTTY_UNIT}: ${active}).\n` +
      `  - is the companion running?  systemctl --user status ${GHOSTTY_UNIT}\n` +
      "  - Plasma asks once whether Ghostty may register global shortcuts; accept it, then check\n" +
      '    System Settings > Shortcuts > VS Code Tmux Terminal.\n' +
      '  - other desktops: press ctrl+` yourself, this command is Plasma-only.',
  );
}

async function list(): Promise<void> {
  const reply = await request({ type: 'list', id: randomUUID() });
  if (!reply.ok) fail(reply.error ?? 'list failed');
  const data = reply.data as { workspaces: { workspaceId: string; name: string; folder: string; sessionName: string; connected: boolean; tabs: { index: number; name: string; active: boolean; cwd: string; command: string }[] }[] };
  if (data.workspaces.length === 0) {
    process.stdout.write('no workspaces\n');
    return;
  }
  for (const ws of data.workspaces) {
    process.stdout.write(`${ws.connected ? '●' : '○'} ${ws.name}  ${ws.folder}\n    session ${ws.sessionName}  id ${ws.workspaceId}\n`);
    for (const t of ws.tabs) process.stdout.write(`    ${t.active ? '*' : ' '} ${t.index}. ${t.name}  (${t.command})  ${t.cwd}\n`);
  }
}

async function status(): Promise<void> {
  const conn = await tryConnect(socketPath());
  if (!conn) {
    process.stdout.write(`daemon: not running (socket ${socketPath()})\n`);
    process.exit(1);
  }
  conn.close();
  const reply = await request({ type: 'status', id: randomUUID() });
  const unit = (await realExec('systemctl', ['--user', 'is-active', GHOSTTY_UNIT])).stdout.trim() || 'unknown';
  const shortcut = await findQuakeShortcut(realExec, GHOSTTY_CLASS);
  const data = { ...(reply.data as object), ghostty: { unit: `${GHOSTTY_UNIT}: ${unit}`, globalShortcut: shortcut?.action ?? 'not registered' } };
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

async function main(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;
  switch (cmd) {
    case 'daemon':
      await runDaemon({ foreground: rest.includes('--foreground') });
      return;
    case 'open':
      return open(rest);
    case 'new':
      return newTab(rest);
    case 'show':
      return show(rest);
    case 'toggle':
      return toggle();
    case 'click':
      return click(rest);
    case 'list':
      return list();
    case 'status':
      return status();
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(USAGE);
      return;
    default:
      fail(`unknown command ${cmd}\n${USAGE}`);
  }
}

main(process.argv.slice(2)).catch((err: Error) => fail(err.message));
