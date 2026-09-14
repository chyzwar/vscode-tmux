import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { TmuxBackend } from './backend/tmux.js';
import { scrubEnv } from '@vscode-tmux/protocol';
import { realExec } from './exec.js';
import { fileLogger } from './log.js';
import { Opener } from './opener.js';
import { Registry } from './registry.js';
import { GhosttyPresenter } from './presenter/ghostty.js';
import { GHOSTTY_CLASS, LOBBY_SESSION, TMUX_SOCKET_NAME, configDir, socketPath, stateDir } from './paths.js';
import { DaemonServer } from './server.js';
import { listen } from './transport.js';
/** Composition root: wires backend, presenter, opener and server, then listens. */
export async function runDaemon(o = {}) {
    const dir = stateDir();
    mkdirSync(dir, { recursive: true });
    const log = fileLogger(join(dir, 'daemon.log'), o.foreground ?? false);
    const env = scrubEnv(process.env);
    const sock = socketPath();
    const tmuxConfig = join(configDir(), 'tmux.conf');
    const ghosttyConfig = join(configDir(), 'ghostty.conf');
    const backend = new TmuxBackend({ exec: realExec, socketName: TMUX_SOCKET_NAME, configPath: tmuxConfig, env });
    const presenter = new GhosttyPresenter({
        backend,
        env,
        configPath: ghosttyConfig,
        appClass: GHOSTTY_CLASS,
        lobbySession: LOBBY_SESSION,
        spawn: (cmd, args, spawnEnv) => {
            log(`launching ${cmd} ${args.join(' ')}`);
            const child = spawn(cmd, args, { env: spawnEnv, detached: true, stdio: 'ignore' });
            child.on('error', (err) => log(`failed to launch ${cmd}: ${err.message}`));
            child.unref();
        },
    });
    const registry = new Registry();
    let xdotool;
    const opener = new Opener({
        registry,
        exec: (cmd, args, opts) => realExec(cmd, args, { ...opts, env: opts?.env ?? env }),
        xdotoolAvailable: async () => (xdotool ??= (await realExec('xdotool', ['version'], { env })).code === 0),
        log,
    });
    const server = new DaemonServer({
        registry,
        backend,
        presenter,
        opener,
        stateFile: join(dir, 'state.json'),
        socketPath: sock,
        sessionEnv: (workspaceId, folder) => ({ VSCODE_TMUX_WORKSPACE_ID: workspaceId, VSCODE_TMUX_WORKSPACE: folder, VSCODE_TMUX_SOCKET: sock }),
        log,
    });
    await backend.ensureServer();
    await listen({
        socketPath: sock,
        onConnection: (conn) => {
            conn.onMessage((msg) => void server.handle(conn, msg));
        },
        onDisconnect: (conn) => server.disconnected(conn),
    });
    process.on('SIGHUP', () => log('ignoring SIGHUP'));
    process.on('SIGTERM', () => {
        log('SIGTERM: exiting');
        process.exit(0);
    });
    log(`daemon pid ${process.pid} listening on ${sock}`);
}
//# sourceMappingURL=daemon.js.map