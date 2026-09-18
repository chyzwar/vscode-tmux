import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
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

  /**
   * The quake dropdown attaches when the user presses the hotkey, not when the
   * daemon says so, which is why `show()` parks the workspace in a hook instead
   * of switching a client. Worth a real client: `switch-client` inside a hook
   * targeting the attaching client is the whole load-bearing assumption.
   */
  it('switches a client that attaches later to the parked session', async () => {
    await backend.createSession({ name: 'parked-xyz', cwd: dir, env: {}, firstTabName: 'Shell' });
    await backend.setAttachTarget('parked-xyz');
    // Note there is no `lobby` session here: the attach below creates it, which is
    // the path `client-attached` alone does not cover.

    // `script` gives the attaching tmux a pty; without one it refuses to attach.
    const attach = spawn('script', ['-qec', backend.attachCommand('lobby').join(' '), '/dev/null'], { env: cleanEnv, stdio: 'ignore' });
    try {
      // The client is briefly on `lobby` before the hook runs, so poll for the switch.
      const client = await waitFor(async () => (await backend.listClients()).find((c) => c.session === 'parked-xyz'));
      expect(client.tty).toMatch(/^\/dev\//);
    } finally {
      attach.kill('SIGKILL');
    }
  });
});

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() >= deadline) throw new Error('timed out waiting for the attaching client to be switched');
    await new Promise((r) => setTimeout(r, 50));
  }
}
