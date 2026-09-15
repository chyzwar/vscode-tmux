import { spawn, spawnSync } from 'node:child_process';
import { scrubEnv } from '@vscode-tmux/protocol';

export interface SpawnResult {
  method: 'systemd-run' | 'detached';
  command: string;
}

/**
 * Start the daemon binary outside the extension host's lifetime. Prefer a transient
 * systemd user unit (clean environment, survives VS Code exiting); fall back to a
 * detached child with a scrubbed environment.
 */
export function spawnDaemon(binPath: string, baseEnv: NodeJS.ProcessEnv, log: (s: string) => void): SpawnResult {
  const env = scrubEnv(baseEnv);
  const unit = `vscode-tmux-${process.getuid?.() ?? 'user'}`;
  const command = `${binPath} daemon`;
  const systemdArgs = ['--user', '--collect', '--quiet', `--unit=${unit}`, `--setenv=PATH=${env.PATH ?? ''}`];
  const systemd = spawnSync('systemd-run', [...systemdArgs, binPath, 'daemon'], { env, encoding: 'utf8', timeout: 5000 });
  if (systemd.status === 0) {
    log(`daemon started via systemd-run (${unit})`);
    return { method: 'systemd-run', command };
  }
  if (/already (exists|loaded|active|running)/i.test(systemd.stderr ?? '')) {
    log(`daemon unit ${unit} already exists (started by another window)`);
    return { method: 'systemd-run', command };
  }
  log(`systemd-run unavailable (${systemd.stderr?.trim() || systemd.error?.message || 'exit ' + systemd.status}); spawning detached`);
  const child = spawn(binPath, ['daemon'], { env, detached: true, stdio: 'ignore' });
  child.unref();
  return { method: 'detached', command };
}
