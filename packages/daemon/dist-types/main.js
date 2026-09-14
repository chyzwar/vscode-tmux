import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { runDaemon } from './daemon.js';
import { computeWorkspaceId } from './ids.js';
import { socketPath } from './paths.js';
import { tryConnect } from './transport.js';
const USAGE = `vscode-tmux — VS Code ⇄ Ghostty/tmux companion

Usage:
  vscode-tmux daemon [--foreground]   run the daemon (normally auto-started by the extension)
  vscode-tmux open <target>           open path[:line[:col]] in this terminal's VS Code window
  vscode-tmux new [name] [-- cmd...]  create a terminal tab in this terminal's workspace
  vscode-tmux show [path]             show the session of the workspace at path (default: cwd) in Ghostty
  vscode-tmux list                    list workspaces, sessions and tabs
  vscode-tmux status                  daemon / tmux / Ghostty status

The \`vscode\` command is an alias for \`vscode-tmux open\`.
`;
async function request(msg) {
    const conn = await tryConnect(socketPath());
    if (!conn)
        throw new Error(`daemon not running (no socket at ${socketPath()})`);
    try {
        return (await conn.request(msg, 15_000));
    }
    finally {
        conn.close();
    }
}
function fail(message, code = 1) {
    process.stderr.write(`vscode-tmux: ${message}\n`);
    process.exit(code);
}
async function open(args) {
    const target = args[0] ?? '.';
    const workspaceId = process.env.VSCODE_TMUX_WORKSPACE_ID;
    const cwd = process.cwd();
    let conn;
    try {
        conn = await tryConnect(socketPath());
    }
    catch {
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
        const msg = { type: 'open', id: randomUUID(), cwd, target };
        if (workspaceId)
            msg.workspaceId = workspaceId;
        else
            process.stderr.write('vscode-tmux: VSCODE_TMUX_WORKSPACE_ID not set; opening in the last active window\n');
        const reply = (await conn.request(msg, 15_000));
        if (!reply.ok)
            fail(reply.error ?? 'open failed');
        const d = reply.data;
        if (d.via === 'extension' && d.raised === false)
            process.stderr.write('vscode-tmux: opened, but the window could not be raised\n');
    }
    finally {
        conn.close();
    }
}
async function newTab(args) {
    const workspaceId = process.env.VSCODE_TMUX_WORKSPACE_ID;
    if (!workspaceId)
        fail('VSCODE_TMUX_WORKSPACE_ID not set; run this inside a vscode-tmux terminal');
    const dash = args.indexOf('--');
    const name = (dash === -1 ? args : args.slice(0, dash)).join(' ').trim();
    const command = dash === -1 ? undefined : args.slice(dash + 1);
    const msg = { type: 'createTerminal', id: randomUUID(), workspaceId, cwd: process.cwd() };
    if (name)
        msg.name = name;
    if (command && command.length)
        msg.command = command;
    const reply = await request(msg);
    if (!reply.ok)
        fail(reply.error ?? 'createTerminal failed');
}
async function show(args) {
    const workspaceId = args[0] ? await computeWorkspaceId(resolve(args[0])) : (process.env.VSCODE_TMUX_WORKSPACE_ID ?? (await computeWorkspaceId(process.cwd())));
    const reply = await request({ type: 'showSession', id: randomUUID(), workspaceId });
    if (!reply.ok)
        fail(reply.error ?? 'showSession failed');
    process.stdout.write(`showing ${reply.data.sessionName}\n`);
}
async function list() {
    const reply = await request({ type: 'list', id: randomUUID() });
    if (!reply.ok)
        fail(reply.error ?? 'list failed');
    const data = reply.data;
    if (data.workspaces.length === 0) {
        process.stdout.write('no workspaces\n');
        return;
    }
    for (const ws of data.workspaces) {
        process.stdout.write(`${ws.connected ? '●' : '○'} ${ws.name}  ${ws.folder}\n    session ${ws.sessionName}  id ${ws.workspaceId}\n`);
        for (const t of ws.tabs)
            process.stdout.write(`    ${t.active ? '*' : ' '} ${t.index}. ${t.name}  (${t.command})  ${t.cwd}\n`);
    }
}
async function status() {
    const conn = await tryConnect(socketPath());
    if (!conn) {
        process.stdout.write(`daemon: not running (socket ${socketPath()})\n`);
        process.exit(1);
    }
    conn.close();
    const reply = await request({ type: 'status', id: randomUUID() });
    process.stdout.write(JSON.stringify(reply.data, null, 2) + '\n');
}
async function main(argv) {
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
main(process.argv.slice(2)).catch((err) => fail(err.message));
//# sourceMappingURL=main.js.map