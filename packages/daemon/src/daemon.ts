import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync } from 'node:fs';
import { join } from 'node:path';
import { TmuxBackend } from './backend/tmux.js';
import { scrubEnv } from '@vscode-tmux/protocol';
import { realExec, type Exec } from './exec.js';
import { fileLogger } from './log.js';
import { Opener } from './opener.js';
import { Registry } from './registry.js';
import { GhosttyPresenter } from './presenter/ghostty.js';
import { selectRunner, type GhosttyRunner } from './presenter/runner.js';
import { selectRaiser, type WindowRaiser } from './raise/index.js';
import { GHOSTTY_CLASS, GHOSTTY_UNIT, LOBBY_SESSION, TMUX_SOCKET_NAME, configDir, socketPath, stateDir } from './paths.js';
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
  const exec: Exec = (cmd, args, opts) => realExec(cmd, args, { ...opts, env: opts?.env ?? env });

  const backend = new TmuxBackend({ exec, socketName: TMUX_SOCKET_NAME, configPath: tmuxConfig, env });
  const ghosttyEnv = { ...env, ...ghosttyEnvFor(settings, env) };
  const spawnGhostty = (cmd: string, args: string[], spawnEnv: NodeJS.ProcessEnv) => {
    log(`launching ${cmd} ${args.join(' ')}`);
    // Keep Ghostty's own stderr: it is the only place GTK/Wayland startup errors show up.
    const out = openSync(join(dir, 'ghostty.log'), 'a');
    const child = spawn(cmd, args, { env: spawnEnv, detached: true, stdio: ['ignore', out, out] });
    child.on('error', (err) => log(`failed to launch ${cmd}: ${err.message}`));
    child.on('exit', (code, signal) => log(`${cmd} exited code=${code} signal=${signal}`));
    child.unref();
    closeSync(out);
  };
  let runner: GhosttyRunner | undefined;
  const presenter = new GhosttyPresenter({
    backend,
    lobbySession: LOBBY_SESSION,
    home: env.HOME ?? '/',
    log,
    // Probed on first use and kept; the unit may be installed while we run.
    runner: async () =>
      (runner ??= await selectRunner({
        exec,
        startTimeoutMs: settings.ghosttyStartTimeoutMs,
        spawn: spawnGhostty,
        env: ghosttyEnv,
        configPath: ghosttyConfig,
        appClass: GHOSTTY_CLASS,
        command: backend.attachCommand(LOBBY_SESSION),
        unit: GHOSTTY_UNIT,
        log,
      })),
  });
  const registry = new Registry();
  let raiser: WindowRaiser | undefined;
  const opener = new Opener({
    registry,
    exec,
    // Probed on first use and kept; re-probed while nothing was found (KWin may come up later).
    raiser: async () => (raiser ??= await selectRaiser({ exec, log, kwinScriptPath: join(dir, 'kwin-raise.js') })),
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
