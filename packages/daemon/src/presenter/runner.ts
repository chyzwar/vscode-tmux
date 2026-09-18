import type { Exec } from '../exec.js';
import type { Log } from '../log.js';

export type Spawn = (cmd: string, args: string[], env: NodeJS.ProcessEnv) => void;

/**
 * Keeps the companion Ghostty process alive. In quake mode the process is a
 * background service with no window: it owns the global ctrl+` shortcut and
 * creates its dropdown surface on demand, so it has to outlive every window and
 * ideally start at login — that is a systemd user unit. Spawning it ourselves is
 * the fallback for sessions without the unit installed.
 */
export interface GhosttyRunner {
  /** Short description for logs. */
  readonly name: string;
  isRunning(): Promise<boolean>;
  start(): Promise<void>;
}

export interface SystemdRunnerOptions {
  exec: Exec;
  unit: string;
  /** `Type=notify`: the unit is only "started" once Ghostty's run loop (and its global shortcut) is up. */
  startTimeoutMs?: number;
}

export function systemdRunner(o: SystemdRunnerOptions): GhosttyRunner {
  return {
    name: `systemd user unit ${o.unit}`,
    async isRunning() {
      return (await o.exec('systemctl', ['--user', 'is-active', '--quiet', o.unit])).code === 0;
    },
    async start() {
      const r = await o.exec('systemctl', ['--user', 'start', o.unit], { timeoutMs: o.startTimeoutMs ?? 30_000 });
      if (r.code !== 0) throw new Error(`systemctl --user start ${o.unit} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
    },
  };
}

export interface SpawnRunnerOptions {
  exec: Exec;
  spawn: Spawn;
  env: NodeJS.ProcessEnv;
  configPath: string;
  appClass: string;
  /** argv the first surface runs (a tmux client). */
  command: string[];
}

/** Ghostty may be slow to own its bus name; do not spawn a second one meanwhile. */
const SPAWN_COOLDOWN_MS = 5_000;

export function spawnRunner(o: SpawnRunnerOptions): GhosttyRunner {
  let lastStart = 0;
  return {
    name: `spawned ghostty --class=${o.appClass}`,
    async isRunning() {
      // The GTK app owns its class as a bus name (gtk-single-instance).
      const r = await o.exec('busctl', ['--user', 'status', o.appClass]);
      if (r.code === 0) return true;
      // No busctl (or no session bus): fall back to a cooldown so a burst of
      // focus changes cannot start a burst of Ghostty processes.
      if (r.code === 127) return Date.now() - lastStart < SPAWN_COOLDOWN_MS;
      return false;
    },
    async start() {
      lastStart = Date.now();
      o.spawn(
        'ghostty',
        [
          `--class=${o.appClass}`,
          '--gtk-single-instance=true',
          `--config-file=${o.configPath}`,
          '--initial-window=false',
          '--quit-after-last-window-closed=false',
          `--command=${o.command.join(' ')}`,
        ],
        o.env,
      );
    },
  };
}

export interface SelectRunnerOptions extends SpawnRunnerOptions {
  unit: string;
  startTimeoutMs?: number;
  log: Log;
}

/** The user unit when it is installed, otherwise a plain spawn. Probed once. */
export async function selectRunner(o: SelectRunnerOptions): Promise<GhosttyRunner> {
  const r = await o.exec('systemctl', ['--user', 'show', o.unit, '--property=LoadState', '--value']);
  if (r.code === 0 && r.stdout.trim() === 'loaded') {
    o.log(`companion Ghostty: systemd user unit ${o.unit}`);
    return systemdRunner(o);
  }
  o.log(`companion Ghostty: ${o.unit} is not installed (${r.stdout.trim() || r.stderr.trim() || `exit ${r.code}`}); spawning ghostty directly`);
  return spawnRunner(o);
}
