import { spawn, spawnSync } from 'node:child_process';
import { scrubEnv } from '@vscode-tmux/protocol';

/** Locate a `node` binary the way the user's shell would (nodenv/nvm shims), falling back to Electron-as-node. */
export function resolveNode(env: NodeJS.ProcessEnv, electronPath: string): { cmd: string; env: NodeJS.ProcessEnv } {
  const shell = env.SHELL || '/bin/bash';
  const probe = spawnSync(shell, ['-lc', 'command -v node'], { env, encoding: 'utf8', timeout: 5000 });
  const node = probe.status === 0 ? probe.stdout.trim().split('\n').pop() : undefined;
  if (node) return { cmd: node, env };
  return { cmd: electronPath, env: { ...env, ELECTRON_RUN_AS_NODE: '1' } };
}

export interface SpawnResult {
  method: 'systemd-run' | 'detached';
  command: string;
}

/**
 * Start the daemon outside the extension host's lifetime. Prefer a transient
 * systemd user unit (clean environment, survives VS Code exiting); fall back
 * to a detached child with a scrubbed environment.
 */
export function spawnDaemon(cliJs: string, baseEnv: NodeJS.ProcessEnv, electronPath: string, log: (s: string) => void): SpawnResult {
  const env = scrubEnv(baseEnv);
  const node = resolveNode(env, electronPath);
  const unit = `vscode-tmux-${process.getuid?.() ?? 'user'}`;
  const systemdArgs = ['--user', '--collect', '--quiet', `--unit=${unit}`, `--setenv=PATH=${env.PATH ?? ''}`];
  if (node.env.ELECTRON_RUN_AS_NODE) systemdArgs.push('--setenv=ELECTRON_RUN_AS_NODE=1');
  const systemd = spawnSync('systemd-run', [...systemdArgs, node.cmd, cliJs, 'daemon'], { env, encoding: 'utf8', timeout: 5000 });
  if (systemd.status === 0) {
    log(`daemon started via systemd-run (${unit})`);
    return { method: 'systemd-run', command: `${node.cmd} ${cliJs} daemon` };
  }
  log(`systemd-run unavailable (${systemd.stderr?.trim() || systemd.error?.message || 'exit ' + systemd.status}); spawning detached`);
  const child = spawn(node.cmd, [cliJs, 'daemon'], { env: node.env, detached: true, stdio: 'ignore' });
  child.unref();
  return { method: 'detached', command: `${node.cmd} ${cliJs} daemon` };
}
