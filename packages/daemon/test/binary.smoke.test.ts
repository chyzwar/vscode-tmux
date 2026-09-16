import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { realExec } from '../src/exec.js';

/**
 * Black-box test of the compiled daemon binary (`bun run build` output). Runs the real
 * runtime the daemon ships with, which is what the unit tests on Node cannot cover:
 * unix socket bind semantics, signals, argv layout.
 */
const BIN = resolve(__dirname, '../dist/vscode-tmux');
const hasTmux = (await realExec('tmux', ['-V'])).code === 0;

describe.skipIf(!existsSync(BIN) || !hasTmux)('compiled daemon binary', () => {
  let tmp: string;
  let sock: string;
  let env: NodeJS.ProcessEnv;
  const children: ChildProcess[] = [];
  const run = (args: string[]) => realExec(BIN, args, { env, timeoutMs: 5000 });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const logText = () => {
    try {
      return readFileSync(join(tmp, 'vscode-tmux', 'daemon.log'), 'utf8');
    } catch {
      return '';
    }
  };
  const startDaemon = () => {
    const child = spawn(BIN, ['daemon', '--foreground'], { env, stdio: 'ignore' });
    const rec = child as ChildProcess & { exitCode: number | null };
    children.push(rec);
    return rec;
  };
  const waitFor = async (pred: () => boolean | Promise<boolean>, ms: number) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      if (await pred()) return true;
      await sleep(100);
    }
    return pred();
  };

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'vst-bin-'));
    sock = join(tmp, 'd.sock');
    mkdirSync(join(tmp, 'vscode-tmux'), { recursive: true });
    copyFileSync(resolve(__dirname, '../../../config/tmux.conf'), join(tmp, 'vscode-tmux', 'tmux.conf'));
    env = {
      PATH: process.env.PATH ?? '/usr/bin:/bin',
      HOME: process.env.HOME ?? tmp,
      TERM: 'xterm-256color',
      XDG_STATE_HOME: tmp,
      XDG_CONFIG_HOME: tmp,
      VSCODE_TMUX_SOCKET: sock,
    };
  });

  afterAll(async () => {
    for (const c of children) if (c.exitCode === null) c.kill('SIGKILL');
    await sleep(100);
    rmSync(tmp, { recursive: true, force: true });
  });

  it('prints usage', async () => {
    const r = await run(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
  });

  it('reports a missing daemon', async () => {
    const r = await run(['status']);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('daemon: not running');
  });

  it('lets exactly one of four concurrently started daemons keep the socket', async () => {
    const four = [1, 2, 3, 4].map(() => startDaemon());
    expect(await waitFor(async () => (await run(['status'])).code === 0, 8000)).toBe(true);
    // Losers exit through AlreadyRunningError (Node semantics) or the ownership watchdog (Bun semantics).
    expect(await waitFor(() => four.filter((c) => c.exitCode === null).length === 1, 8000)).toBe(true);
    const losers = four.filter((c) => c.exitCode !== null);
    expect(losers).toHaveLength(3);
    for (const l of losers) expect(l.exitCode).toBe(0);
    expect(logText().match(/already owns|taken over/g) ?? []).toHaveLength(3);
    // The survivor still answers after the losers are gone (no runtime unlinked its socket on exit).
    const status = await run(['status']);
    expect(status.code).toBe(0);
    const survivor = four.find((c) => c.exitCode === null)!;
    const json = JSON.parse(status.stdout) as { socket: string; pid: number; runtime: string };
    expect(json.socket).toBe(sock);
    expect(json.pid).toBe(survivor.pid);
    expect(json.runtime).toMatch(/^bun \d/);
    expect(statSync(sock).mode & 0o777).toBe(0o600);
  });

  it('lists no workspaces', async () => {
    const r = await run(['list']);
    expect(r.code).toBe(0);
    expect(r.stdout.toLowerCase()).toContain('no workspaces');
  });

  it('ignores SIGHUP and exits cleanly on SIGTERM', async () => {
    const survivor = children.find((c) => c.exitCode === null)!;
    survivor.kill('SIGHUP');
    await sleep(300);
    expect(survivor.exitCode).toBeNull();
    expect((await run(['status'])).code).toBe(0);
    expect(logText()).toContain('ignoring SIGHUP');
    survivor.kill('SIGTERM');
    expect(await waitFor(() => survivor.exitCode !== null, 3000)).toBe(true);
    expect(survivor.exitCode).toBe(0);
    expect(logText()).toContain('SIGTERM: exiting');
  });
});
