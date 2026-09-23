import { spawn } from 'node:child_process';
import type { DaemonRequestType, Reply, RequestBody, ResultOf } from '@vscode-tmux/protocol';
import { join, resolve } from 'node:path';
import { Command } from 'commander';
import { peelCommand } from './cliargs.js';
import { runDaemon } from './daemon.js';
import { toggleDropdownHeight } from './dropdown.js';
import { realExec } from './exec.js';
import { computeWorkspaceId } from './ids.js';
import { GHOSTTY_CLASS, GHOSTTY_UNIT, configDir, socketPath } from './paths.js';
import { findQuakeShortcut, toggleQuake } from './quake.js';
import { loadSettings } from './settings.js';
import { parseClickTarget } from './target.js';
import { tryConnect } from './transport.js';

async function request<T extends DaemonRequestType>(type: T, body: RequestBody<T>): Promise<Reply<ResultOf<T>>> {
  const conn = await tryConnect(socketPath());
  if (!conn) throw new Error(`daemon not running (no socket at ${socketPath()})`);
  try {
    return await conn.request(type, body, 15_000);
  } finally {
    conn.close();
  }
}

function fail(message: string, code = 1): never {
  process.stderr.write(`vscode-tmux: ${message}\n`);
  process.exit(code);
}

async function open(target: string): Promise<void> {
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
    const body: RequestBody<'open'> = { cwd, target };
    if (workspaceId) body.workspaceId = workspaceId;
    else process.stderr.write('vscode-tmux: VSCODE_TMUX_WORKSPACE_ID not set; opening in the last active window\n');
    const reply = await conn.request('open', body, 15_000);
    if (!reply.ok) fail(reply.error);
    if (reply.data.via === 'extension' && reply.data.raised === false) process.stderr.write('vscode-tmux: opened, but the window could not be raised\n');
  } finally {
    conn.close();
  }
}

async function newTab(words: string[], command: string[] | undefined): Promise<void> {
  const workspaceId = process.env.VSCODE_TMUX_WORKSPACE_ID;
  if (!workspaceId) fail('VSCODE_TMUX_WORKSPACE_ID not set; run this inside a vscode-tmux terminal');
  const name = words.join(' ').trim();
  const body: RequestBody<'createTerminal'> = { workspaceId, cwd: process.cwd() };
  if (name) body.name = name;
  if (command?.length) body.command = command;
  const reply = await request('createTerminal', body);
  if (!reply.ok) fail(reply.error);
}

async function show(path: string | undefined): Promise<void> {
  const workspaceId = path ? await computeWorkspaceId(resolve(path)) : (process.env.VSCODE_TMUX_WORKSPACE_ID ?? (await computeWorkspaceId(process.cwd())));
  const reply = await request('showSession', { workspaceId });
  if (!reply.ok) fail(reply.error);
  process.stdout.write(`showing ${reply.data.sessionName}\n`);
}

interface ClickOptions {
  session?: string;
  cwd?: string;
  word?: string;
  link?: string;
  keep?: boolean;
}

/**
 * Open the file the user clicked on in a terminal tab.
 *
 * tmux runs this from a mouse binding, so it hands us the session (not the
 * workspace: the binding runs outside the shell and never sees its environment),
 * the pane's directory, the word under the pointer and the OSC 8 link if the
 * program emitted one. Anything that is not an existing file is silently
 * ignored — a click on prose must do nothing.
 */
async function click(o: ClickOptions): Promise<void> {
  const cwd = o.cwd || process.cwd();
  const target = parseClickTarget(o.word ?? '', o.link ?? '', cwd);
  if (!target) return;

  const body: RequestBody<'open'> = { cwd, target: gotoArg(target) };
  if (o.session) body.sessionName = o.session;
  const reply = await request('open', body);
  if (!reply.ok) fail(reply.error);
  // The dropdown covers the editor it just raised, so get out of the way.
  if (!o.keep) await toggleQuake(realExec, GHOSTTY_CLASS).catch(() => undefined);
}

const gotoArg = (t: { path: string; line?: number; col?: number }): string =>
  t.path + (t.line !== undefined ? `:${t.line}` + (t.col !== undefined ? `:${t.col}` : '') : '');

const noShortcutHelp = (active: string): string =>
  `no global shortcut registered for ${GHOSTTY_CLASS} (${GHOSTTY_UNIT}: ${active}).\n` +
  `  - is the companion running?  systemctl --user status ${GHOSTTY_UNIT}\n` +
  "  - Plasma asks once whether Ghostty may register global shortcuts; accept it, then check\n" +
  '    System Settings > Shortcuts > VS Code Tmux Terminal.\n' +
  '  - other desktops: press ctrl+` yourself, this command is Plasma-only.';

const unitState = async (): Promise<string> => (await realExec('systemctl', ['--user', 'is-active', GHOSTTY_UNIT])).stdout.trim() || 'unknown';

/**
 * Press the dropdown's global shortcut through kglobalaccel. Ghostty has no IPC
 * for `toggle_quick_terminal`, so this only works where the desktop registered
 * the `global:` keybind for us (Plasma).
 */
async function toggle(): Promise<void> {
  const found = await toggleQuake(realExec, GHOSTTY_CLASS);
  if (found) {
    process.stdout.write(`toggled ${found.action}\n`);
    return;
  }
  fail(noShortcutHelp(await unitState()));
}

/** Rewrite `quick-terminal-size`, reload, and rebuild the dropdown window; see dropdown.ts for why. */
async function height(): Promise<void> {
  const settings = loadSettings(join(configDir(), 'config.json'));
  const r = await toggleDropdownHeight({
    exec: realExec,
    unit: GHOSTTY_UNIT,
    appClass: GHOSTTY_CLASS,
    configPath: join(configDir(), 'ghostty.conf'),
    full: settings.ghosttyDropdownFull,
    short: settings.ghosttyDropdownShort,
  });
  switch (r.state) {
    case 'rebuilt':
      process.stdout.write(`dropdown ${r.size}\n`);
      return;
    case 'no-window':
      process.stdout.write(`dropdown ${r.size} on next ctrl+\`\n`);
      return;
    case 'not-running':
      process.stdout.write(`dropdown ${r.size} when ${GHOSTTY_UNIT} starts\n`);
      return;
    case 'closed':
      fail(`dropdown closed; ${noShortcutHelp(await unitState())}`);
  }
}

async function list(): Promise<void> {
  const reply = await request('list', {});
  if (!reply.ok) fail(reply.error);
  const data = reply.data;
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
  const reply = await request('status', {});
  if (!reply.ok) fail(reply.error);
  const unit = await unitState();
  const shortcut = await findQuakeShortcut(realExec, GHOSTTY_CLASS);
  const data = { ...reply.data, ghostty: { unit: `${GHOSTTY_UNIT}: ${unit}`, globalShortcut: shortcut?.action ?? 'not registered' } };
  process.stdout.write(JSON.stringify(data, null, 2) + '\n');
}

/** `newCommand` is what followed `--` on the command line; commander does not keep that boundary (see cliargs.ts). */
export function buildProgram(newCommand: string[] | undefined): Command {
  const program = new Command('vscode-tmux')
    .description('VS Code ⇄ Ghostty/tmux companion. The `vscode` command is an alias for `vscode-tmux open`.')
    .showHelpAfterError()
    .configureOutput({ writeErr: (s) => process.stderr.write(s.replace(/^error: /, 'vscode-tmux: ')) });

  program
    .command('daemon')
    .description('run the daemon (normally auto-started by the extension)')
    .option('--foreground', 'stay attached to the terminal instead of detaching')
    .action((o: { foreground?: boolean }) => runDaemon({ foreground: o.foreground ?? false }));

  program
    .command('open')
    .description("open path[:line[:col]] in this terminal's VS Code window")
    .argument('[target]', 'file, with an optional :line[:col]', '.')
    .action(open);

  program
    .command('new')
    .description("create a terminal tab in this terminal's workspace")
    .usage('[name...] [-- cmd...]')
    .argument('[name...]', 'tab name; put the command to run after --')
    .action((words: string[]) => newTab(words, newCommand));

  program
    .command('show')
    .description('show the session of the workspace at path (default: cwd) in Ghostty')
    .argument('[path]', 'workspace folder')
    .action(show);

  program.command('toggle').description('pull the Ghostty dropdown down / up (same as ctrl+`)').action(toggle);

  program.command('height').description('flip the dropdown between full height and a short strip (F11 in tmux.conf)').action(height);

  program
    .command('click')
    .description('open what was clicked in a tab (bound to the mouse in tmux.conf)')
    .option('--session <name>', 'tmux session of the pane')
    .option('--cwd <dir>', 'current directory of the pane (default: cwd)')
    .option('--word <text>', 'word under the pointer')
    .option('--link <url>', 'OSC 8 hyperlink under the pointer, if any')
    .option('--keep', 'leave the dropdown open afterwards')
    .action(click);

  program.command('list').description('list workspaces, sessions and tabs').action(list);
  program.command('status').description('daemon / tmux / Ghostty status').action(status);

  return program;
}

const { argv, command } = peelCommand(process.argv.slice(2));
buildProgram(command)
  .parseAsync(argv, { from: 'user' })
  .catch((err: Error) => fail(err.message));
