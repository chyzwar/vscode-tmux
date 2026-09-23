import { describe, expect, it } from 'vitest';
import type { Client, Tab } from '@vscode-tmux/protocol';
import type { SessionBackend } from '../src/backend/types.js';
import { GhosttyPresenter, pickClient } from '../src/presenter/ghostty.js';
import type { GhosttyRunner } from '../src/presenter/runner.js';

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
    async setAttachTarget(session) { calls.push(`attachTarget:${session}`); },
    attachCommand(session) { return ['tmux', '-L', 'x', 'new-session', '-A', '-s', session]; },
  };
  return { backend, calls, sessions };
}

function makePresenter(clients: Client[], running = false) {
  const { backend, calls, sessions } = fakeBackend(clients);
  const runner: GhosttyRunner = {
    name: 'fake',
    async isRunning() { return running; },
    async start() { running = true; calls.push('start'); },
  };
  const presenter = new GhosttyPresenter({
    backend,
    runner: async () => runner,
    lobbySession: 'lobby',
    home: '/home/u',
  });
  return { presenter, calls, sessions, clients };
}

describe('GhosttyPresenter.show', () => {
  it('parks the session as the attach target before touching Ghostty', async () => {
    const { presenter, calls } = makePresenter([]);
    await presenter.show('proj-a');
    expect(calls.indexOf('attachTarget:proj-a')).toBe(0);
  });

  it('switches the client that is already attached', async () => {
    const { presenter, calls } = makePresenter([control('lobby'), ghostty('lobby')], true);
    await presenter.show('proj-a');
    expect(calls).toContain('switch:/dev/pts/7:proj-a');
    expect(calls).not.toContain('start');
  });

  it('does not switch when the client already shows the session', async () => {
    const { presenter, calls } = makePresenter([ghostty('proj-a')], true);
    await presenter.show('proj-a');
    expect(calls.filter((c) => c.startsWith('switch:'))).toEqual([]);
  });

  it('starts the companion and creates the lobby when nothing is running', async () => {
    const { presenter, calls, sessions } = makePresenter([]);
    await presenter.show('proj-b');
    expect(calls).toContain('create:lobby');
    expect(calls).toContain('start');
    expect(sessions.has('lobby')).toBe(true);
  });

  it('does not wait for a client: the user opens the dropdown, not the daemon', async () => {
    const { presenter, calls } = makePresenter([]);
    await expect(presenter.show('proj-c')).resolves.toBeUndefined();
    expect(calls.filter((c) => c.startsWith('switch:'))).toEqual([]);
  });

  it('starts only once for concurrent shows', async () => {
    const { presenter, calls } = makePresenter([]);
    await Promise.all([presenter.show('proj-a'), presenter.show('proj-b'), presenter.ensureVisible()]);
    expect(calls.filter((c) => c === 'start')).toHaveLength(1);
  });
});
