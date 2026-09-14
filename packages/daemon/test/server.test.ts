import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message } from '@vscode-tmux/protocol';
import type { Client, SessionBackend, Tab } from '../src/backend/types.js';
import type { Presenter } from '../src/presenter/types.js';
import type { Connection } from '../src/registry.js';
import { DaemonServer } from '../src/server.js';
import { loadState } from '../src/state.js';

function fakeBackend() {
  const sessions = new Map<string, Tab[]>();
  const calls: string[] = [];
  let nextId = 1;
  const backend: SessionBackend = {
    async ensureServer() { calls.push('ensureServer'); },
    async hasSession(name) { return sessions.has(name); },
    async createSession(o) { calls.push(`create:${o.name}:${o.env.VSCODE_TMUX_WORKSPACE_ID}`); sessions.set(o.name, [{ id: `@${nextId++}`, index: 1, name: o.firstTabName, cwd: o.cwd, active: true, command: 'bash' }]); },
    async listSessions() { return [...sessions.keys()]; },
    async listTabs(s) { return sessions.get(s) ?? []; },
    async newTab(s, o) { const tabs = sessions.get(s)!; tabs.forEach((t) => (t.active = false)); const tab: Tab = { id: `@${nextId++}`, index: tabs.length + 1, name: o.name, cwd: o.cwd, active: true, command: o.command?.[0] ?? 'bash' }; tabs.push(tab); calls.push(`newTab:${s}:${o.name}`); return tab; },
    async selectTab(s, id) { calls.push(`select:${s}:${id}`); },
    async listClients(): Promise<Client[]> { return []; },
    async switchClient() {},
    attachCommand: (s) => ['tmux', s],
  };
  return { backend, calls, sessions };
}

function fakePresenter() {
  const shown: string[] = [];
  const presenter: Presenter = { async show(s) { shown.push(s); }, async ensureVisible() {} };
  return { presenter, shown };
}

function fakeConn() {
  const sent: Message[] = [];
  const conn: Connection = { send: (m) => { sent.push(m); }, async request() { throw new Error('unused'); } };
  return { conn, sent };
}

function setup() {
  const { backend, calls, sessions } = fakeBackend();
  const { presenter, shown } = fakePresenter();
  const stateFile = join(mkdtempSync(join(tmpdir(), 'vst-srv-')), 'state.json');
  const opened: unknown[] = [];
  const server = new DaemonServer({
    backend,
    presenter,
    stateFile,
    socketPath: '/tmp/unused.sock',
    sessionEnv: (id, folder) => ({ VSCODE_TMUX_WORKSPACE_ID: id, VSCODE_TMUX_WORKSPACE: folder }),
    opener: { async open(i) { opened.push(i); return { via: 'extension' as const }; } },
    focusDebounceMs: 0,
    log: () => {},
  });
  return { server, calls, sessions, shown, stateFile, opened };
}

const hello = (id: string, folder: string, focused = false): Message => ({ type: 'hello', id: `h-${id}`, workspaceId: id, folder, name: folder.split('/').pop()!, extHostPid: 1, focused });

describe('DaemonServer', () => {
  it('hello creates the session once and replies with its name', async () => {
    const { server, calls } = setup();
    const { conn } = fakeConn();
    await server.handle(conn, hello('abcdef0123456789', '/w/project-a'));
    await server.handle(conn, hello('abcdef0123456789', '/w/project-a'));
    expect(calls.filter((c) => c.startsWith('create:'))).toEqual(['create:project-a-abcdef01:abcdef0123456789']);
  });

  it('rapid focus changes coalesce into the latest session', async () => {
    const { server, shown } = setup();
    const { conn } = fakeConn();
    await server.handle(conn, hello('abcdef0123456789', '/w/project-a'));
    await server.handle(conn, hello('0123456789abcdef', '/w/project-b'));
    await server.handle(conn, { type: 'focus', workspaceId: 'abcdef0123456789', focused: true });
    await server.handle(conn, { type: 'focus', workspaceId: '0123456789abcdef', focused: true });
    await server.flush();
    expect(shown).toEqual(['project-b-01234567']);
  });

  it('hello reply carries sessionName and created flag; state is persisted', async () => {
    const { server, stateFile } = setup();
    const { conn, sent } = fakeConn();
    await server.handle(conn, hello('abcdef0123456789', '/w/project-a'));
    expect(sent[0]).toEqual({ type: 'result', id: 'h-abcdef0123456789', ok: true, data: { sessionName: 'project-a-abcdef01', created: true } });
    const state = loadState(stateFile);
    expect(state.workspaces['abcdef0123456789']).toMatchObject({ folder: '/w/project-a', sessionName: 'project-a-abcdef01', tabs: [{ name: 'Shell', cwd: '/w/project-a' }] });
  });

  it('a focused hello and later focus messages show the session', async () => {
    const { server, shown } = setup();
    const { conn } = fakeConn();
    await server.handle(conn, hello('abcdef0123456789', '/w/project-a', true));
    await server.flush();
    await server.handle(conn, hello('0123456789abcdef', '/w/project-b'));
    await server.handle(conn, { type: 'focus', workspaceId: '0123456789abcdef', focused: true });
    await server.handle(conn, { type: 'focus', workspaceId: '0123456789abcdef', focused: false });
    await server.flush();
    expect(shown).toEqual(['project-a-abcdef01', 'project-b-01234567']);
  });

  it('createTerminal appends a tab, selects it, persists, and shows the session', async () => {
    const { server, calls, shown, stateFile } = setup();
    const { conn, sent } = fakeConn();
    await server.handle(conn, hello('abcdef0123456789', '/w/project-a'));
    await server.handle(conn, { type: 'createTerminal', id: 'c1', workspaceId: 'abcdef0123456789', name: 'Server', command: ['npm', 'run', 'dev'] });
    expect(calls).toContain('newTab:project-a-abcdef01:Server');
    expect(sent[1]).toMatchObject({ type: 'result', id: 'c1', ok: true });
    expect(loadState(stateFile).workspaces['abcdef0123456789']!.tabs.map((t) => t.name)).toEqual(['Shell', 'Server']);
    await server.flush();
    expect(shown).toContain('project-a-abcdef01');
  });

  it('createTerminal without a name picks Terminal N', async () => {
    const { server, calls } = setup();
    const { conn } = fakeConn();
    await server.handle(conn, hello('abcdef0123456789', '/w/project-a'));
    await server.handle(conn, { type: 'createTerminal', id: 'c1', workspaceId: 'abcdef0123456789' });
    expect(calls).toContain('newTab:project-a-abcdef01:Terminal 2');
  });

  it('open is delegated to the opener and answered', async () => {
    const { server, opened } = setup();
    const { conn, sent } = fakeConn();
    await server.handle(conn, { type: 'open', id: 'o1', workspaceId: 'x', cwd: '/w', target: 'a.ts:1' });
    expect(opened).toEqual([{ workspaceId: 'x', cwd: '/w', target: 'a.ts:1' }]);
    expect(sent[0]).toMatchObject({ type: 'result', id: 'o1', ok: true, data: { via: 'extension' } });
  });

  it('list reports workspaces with their tabs', async () => {
    const { server } = setup();
    const { conn, sent } = fakeConn();
    await server.handle(conn, hello('abcdef0123456789', '/w/project-a'));
    await server.handle(conn, { type: 'list', id: 'l1' });
    expect(sent[1]).toMatchObject({ type: 'result', id: 'l1', ok: true, data: { workspaces: [{ workspaceId: 'abcdef0123456789', sessionName: 'project-a-abcdef01', connected: true, tabs: [{ name: 'Shell' }] }] } });
  });

  it('unknown workspace in createTerminal yields an error result', async () => {
    const { server } = setup();
    const { conn, sent } = fakeConn();
    await server.handle(conn, { type: 'createTerminal', id: 'c9', workspaceId: 'nope' });
    expect(sent[0]).toMatchObject({ type: 'result', id: 'c9', ok: false });
  });

  it('disconnect detaches the workspace', async () => {
    const { server } = setup();
    const { conn, sent } = fakeConn();
    await server.handle(conn, hello('abcdef0123456789', '/w/project-a'));
    server.disconnected(conn);
    await server.handle(conn, { type: 'list', id: 'l1' });
    expect(sent[1]).toMatchObject({ data: { workspaces: [{ connected: false }] } });
  });
});
