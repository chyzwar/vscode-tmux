import { describe, expect, it } from 'vitest';
import { fakeExec } from './fakeExec.js';
import { selectRunner, spawnRunner, systemdRunner } from '../src/presenter/runner.js';

const spawnOptions = {
  spawn: () => {},
  env: {},
  configPath: '/cfg/ghostty.conf',
  appClass: 'dev.test.Ghostty',
  command: ['tmux', '-L', 'x', 'new-session', '-A', '-s', 'lobby'],
};

describe('systemdRunner', () => {
  it('asks systemd whether the unit is up', async () => {
    const { exec, calls } = fakeExec((cmd) => (cmd === 'systemctl' ? { code: 0, stdout: '', stderr: '' } : undefined));
    expect(await systemdRunner({ exec, unit: 'u.service' }).isRunning()).toBe(true);
    expect(calls[0]!.args).toEqual(['--user', 'is-active', '--quiet', 'u.service']);
  });

  it('reports why the unit would not start', async () => {
    const { exec } = fakeExec((cmd) => (cmd === 'systemctl' ? { code: 1, stdout: '', stderr: 'Unit u.service not found.' } : undefined));
    await expect(systemdRunner({ exec, unit: 'u.service' }).start()).rejects.toThrow(/Unit u.service not found/);
  });
});

describe('spawnRunner', () => {
  it('treats an owned bus name as running', async () => {
    const { exec } = fakeExec((cmd) => (cmd === 'busctl' ? { code: 0, stdout: 'Name=dev.test.Ghostty', stderr: '' } : undefined));
    expect(await spawnRunner({ ...spawnOptions, exec }).isRunning()).toBe(true);
  });

  it('launches a windowless Ghostty that outlives its dropdown', async () => {
    const { exec } = fakeExec((cmd) => (cmd === 'busctl' ? { code: 1, stdout: '', stderr: 'not activatable' } : undefined));
    const spawned: string[][] = [];
    const runner = spawnRunner({ ...spawnOptions, exec, spawn: (_cmd, args) => spawned.push(args) });
    expect(await runner.isRunning()).toBe(false);
    await runner.start();
    expect(spawned[0]).toEqual([
      '--class=dev.test.Ghostty',
      '--gtk-single-instance=true',
      '--config-file=/cfg/ghostty.conf',
      '--initial-window=false',
      '--quit-after-last-window-closed=false',
      '--command=tmux -L x new-session -A -s lobby',
    ]);
  });

  it('does not respawn in a burst when busctl is missing', async () => {
    const { exec } = fakeExec((cmd) => (cmd === 'busctl' ? { code: 127, stdout: '', stderr: 'not found' } : undefined));
    const runner = spawnRunner({ ...spawnOptions, exec });
    expect(await runner.isRunning()).toBe(false);
    await runner.start();
    expect(await runner.isRunning()).toBe(true);
  });
});

describe('selectRunner', () => {
  const log = () => {};

  it('prefers the user unit when it is installed', async () => {
    const { exec } = fakeExec((cmd) => (cmd === 'systemctl' ? { code: 0, stdout: 'loaded\n', stderr: '' } : undefined));
    const runner = await selectRunner({ ...spawnOptions, exec, unit: 'u.service', log });
    expect(runner.name).toContain('u.service');
  });

  it('falls back to spawning when the unit is not installed', async () => {
    const { exec } = fakeExec((cmd) => (cmd === 'systemctl' ? { code: 1, stdout: 'not-found\n', stderr: '' } : undefined));
    const runner = await selectRunner({ ...spawnOptions, exec, unit: 'u.service', log });
    expect(runner.name).toContain('dev.test.Ghostty');
  });
});
