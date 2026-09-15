import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
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
import { ghosttyEnvFor, loadSettings } from './settings.js';
import { AlreadyRunningError, listen, type SocketConnection } from './transport.js';

export interface DaemonOptions {
  foreground?: boolean;
}

/** Composition root: wires backend, presenter, opener and server, then listens. */
export async function runDaemon(o: DaemonOptions = {}): Promise<void> {
  const dir = stateDir();
  mkdirSync(dir, { recursive: true });
  const log = fileLogger(join(dir, 'daemon.log'), o.foreground ?? false);
  const env = scrubEnv(process.env);
  const sock = socketPath();
  const tmuxConfig = join(configDir(), 'tmux.conf');
  const ghosttyConfig = join(configDir(), 'ghostty.conf');
  const settings = loadSettings(join(configDir(), 'config.json'));
  log(`settings: ${JSON.stringify(settings)}`);

  const backend = new TmuxBackend({ exec: realExec, socketName: TMUX_SOCKET_NAME, configPath: tmuxConfig, env });
  const presenter = new GhosttyPresenter({
    backend,
    env: { ...env, ...ghosttyEnvFor(settings) },
    timeoutMs: settings.ghosttyStartTimeoutMs,
    configPath: ghosttyConfig,
    appClass: GHOSTTY_CLASS,
    lobbySession: LOBBY_SESSION,
    spawn: (cmd, args, spawnEnv) => {
      log(`launching ${cmd} ${args.join(' ')}`);
      // Keep Ghostty's own stderr: it is the only place GTK/Wayland startup errors show up.
      const out = openSync(join(dir, 'ghostty.log'), 'a');
      const child = spawn(cmd, args, { env: spawnEnv, detached: true, stdio: ['ignore', out, out] });
      child.on('error', (err) => log(`failed to launch ${cmd}: ${err.message}`));
      child.on('exit', (code, signal) => log(`${cmd} exited code=${code} signal=${signal}`));
      child.unref();
      closeSync(out);
    },
  });
  const registry = new Registry();
  let xdotool: boolean | undefined;
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
  try {
    await listen({
      socketPath: sock,
      onConnection: (conn: SocketConnection) => {
        conn.onMessage((msg) => void server.handle(conn, msg));
      },
      onDisconnect: (conn) => server.disconnected(conn),
      onPathLost: () => {
        log(`socket path ${sock} was taken over by another daemon; exiting`);
        process.exit(0);
      },
    });
  } catch (err) {
    if (err instanceof AlreadyRunningError) {
      log(`another daemon already owns ${sock}; exiting`);
      return;
    }
    throw err;
  }
  process.on('SIGHUP', () => log('ignoring SIGHUP'));
  process.on('SIGTERM', () => {
    log('SIGTERM: exiting');
    process.exit(0);
  });
  log(`daemon pid ${process.pid} listening on ${sock}`);
}
