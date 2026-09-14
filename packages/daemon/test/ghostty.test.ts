import { describe, expect, it } from 'vitest';
import type { Client, SessionBackend, Tab } from '../src/backend/types.js';
import { GhosttyPresenter, pickClient } from '../src/presenter/ghostty.js';

const ghostty = (session: string, tty = '/dev/pts/7'): Client => ({ tty, termname: 'xterm-ghostty', control: false, session, pid: 1 });
const control = (session: string): Client => ({ tty: '/dev/pts/9', termname: 'tmux-256color', control: true, session, pid: 2 });
const other = (session: string): Client => ({ tty: '/dev/pts/3', termname: 'xterm-256color', control: false, session, pid: 3 });

describe('pickClient', () => {
  it('prefers a non-control xterm-ghostty client', () => {
    expect(pickClient([control('lobby'), other('a'), ghostty('b')])).toEqual(ghostty('b'));
  });
  it('falls back to any non-control client', () => {
    expect(pickClient([control('lobby'), other('a')])).toEqual(other('a'));
  });
  it('returns undefined when only control clients exist', () => {
    expect(pickClient([control('lobby')])).toBeUndefined();
  });
});

function fakeBackend(clients: Client[]) {
  const calls: string[] = [];
  const sessions = new Set<string>();
  const backend: SessionBackend = {
    async ensureServer() { calls.push('ensureServer'); },
    async hasSession(name) { return sessions.has(name); },
    async createSession(o) { sessions.add(o.name); calls.push(`create:${o.name}`); },
    async listSessions() { return [...sessions]; },
    async listTabs(): Promise<Tab[]> { return []; },
    async newTab() { throw new Error('unused'); },
    async selectTab() {},
    async listClients() { return clients; },
    async switchClient(tty, session) { calls.push(`switch:${tty}:${session}`); const c = clients.find((x) => x.tty === tty); if (c) c.session = session; },
    attachCommand(session) { return ['tmux', '-L', 'x', 'new-session', '-A', '-s', session]; },
  };
  return { backend, calls, sessions };
}

function makePresenter(clients: Client[]) {
  const { backend, calls, sessions } = fakeBackend(clients);
  const spawned: { cmd: string; args: string[] }[] = [];
  const presenter = new GhosttyPresenter({
    backend,
    spawn: (cmd, args) => { spawned.push({ cmd, args }); },
    env: {},
    configPath: '/cfg/ghostty.conf',
    appClass: 'dev.test.Ghostty',
    lobbySession: 'lobby',
    sleep: async () => {},
    timeoutMs: 500,
  });
  return { presenter, calls, spawned, sessions, clients };
}

describe('GhosttyPresenter.show', () => {
  it('switches the existing Ghostty client without spawning', async () => {
    const { presenter, calls, spawned } = makePresenter([control('lobby'), ghostty('lobby')]);
    await presenter.show('proj-a');
    expect(spawned).toEqual([]);
    expect(calls).toContain('switch:/dev/pts/7:proj-a');
  });

  it('does not switch when the client already shows the session', async () => {
    const { presenter, calls } = makePresenter([ghostty('proj-a')]);
    await presenter.show('proj-a');
    expect(calls.filter((c) => c.startsWith('switch:'))).toEqual([]);
  });

  it('launches Ghostty once when no client exists, then switches once it appears', async () => {
    const clients: Client[] = [];
    const { presenter, calls, spawned } = makePresenter(clients);
    // simulate Ghostty attaching after the spawn
    const p = presenter.show('proj-b');
    await Promise.resolve();
    clients.push(ghostty('lobby'));
    await p;
    expect(spawned).toHaveLength(1);
    expect(spawned[0]!.cmd).toBe('ghostty');
    expect(spawned[0]!.args).toEqual([
      '--class=dev.test.Ghostty',
      '--gtk-single-instance=true',
      '--config-file=/cfg/ghostty.conf',
      '--command=tmux -L x new-session -A -s lobby',
    ]);
    expect(calls).toContain('create:lobby');
    expect(calls).toContain('switch:/dev/pts/7:proj-b');
  });

  it('gives up with an error if no client appears before the timeout', async () => {
    const { presenter } = makePresenter([]);
    await expect(presenter.show('proj-c')).rejects.toThrow(/no terminal client/i);
  });

  it('launches only once for concurrent show() calls', async () => {
    const clients: Client[] = [];
    const { presenter, spawned } = makePresenter(clients);
    const a = presenter.show('proj-a');
    const b = presenter.show('proj-b');
    await Promise.resolve();
    clients.push(ghostty('lobby'));
    await Promise.all([a, b]);
    expect(spawned).toHaveLength(1);
  });
});
