import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { TmuxBackend } from '../src/backend/tmux.js';
import { realExec } from '../src/exec.js';

const hasTmux = (await realExec('tmux', ['-V'])).code === 0;
const socketName = `vst-it-${process.pid}`;
const configPath = resolve(__dirname, '../../../config/tmux.conf');
const cleanEnv: NodeJS.ProcessEnv = { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: process.env.HOME ?? '/tmp', TERM: 'xterm-256color' };

describe.skipIf(!hasTmux)('TmuxBackend against a real tmux server', () => {
  const backend = new TmuxBackend({ exec: realExec, socketName, configPath, env: cleanEnv });
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'vst-it-'));
    await backend.ensureServer();
  });

  afterAll(async () => {
    await realExec('tmux', ['-L', socketName, 'kill-server'], { env: cleanEnv });
    rmSync(dir, { recursive: true, force: true });
  });

  it('creates a session with env, lists tabs, adds a tab, selects it', async () => {
    expect(await backend.hasSession('proj-abc')).toBe(false);
    await backend.createSession({ name: 'proj-abc', cwd: dir, env: { VSCODE_TMUX_WORKSPACE_ID: 'abc' }, firstTabName: 'Shell' });
    expect(await backend.hasSession('proj-abc')).toBe(true);
    expect(await backend.listSessions()).toContain('proj-abc');

    const tabs = await backend.listTabs('proj-abc');
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ name: 'Shell', active: true, index: 1 });

    const env = await realExec('tmux', ['-L', socketName, 'show-environment', '-t', '=proj-abc', 'VSCODE_TMUX_WORKSPACE_ID'], { env: cleanEnv });
    expect(env.stdout.trim()).toBe('VSCODE_TMUX_WORKSPACE_ID=abc');

    const tab = await backend.newTab('proj-abc', { name: 'Sleeper', cwd: dir, command: ['sleep', '30'] });
    expect(tab.name).toBe('Sleeper');
    expect(tab.command).toBe('sleep');
    expect(tab.active).toBe(true);

    await backend.selectTab('proj-abc', tabs[0]!.id);
    const after = await backend.listTabs('proj-abc');
    expect(after.find((t) => t.id === tabs[0]!.id)?.active).toBe(true);
    expect(after.map((t) => t.name)).toEqual(['Shell', 'Sleeper']);

    expect(await backend.listClients()).toEqual([]);
    expect(backend.attachCommand('lobby')).toEqual(['tmux', '-L', socketName, '-f', configPath, 'new-session', '-A', '-s', 'lobby']);
  });
});
