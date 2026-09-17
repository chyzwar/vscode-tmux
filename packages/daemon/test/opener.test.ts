import { describe, expect, it } from 'vitest';
import type { Message } from '@vscode-tmux/protocol';
import { Opener, type WindowRaiser } from '../src/opener.js';
import { escapeRegex } from '../src/raise/match.js';
import { XdotoolRaiser } from '../src/raise/xdotool.js';
import { Registry, type Connection } from '../src/registry.js';
import { fakeExec } from './fakeExec.js';

function fakeConnection(reply: (m: Message) => Message) {
  const received: Message[] = [];
  const conn: Connection = {
    send(m) { received.push(m); },
    async request(m) { received.push(m); return reply(m); },
  };
  return { conn, received };
}

const ws = { workspaceId: 'abc123', folder: '/w/project-a', name: 'project-a', sessionName: 'project-a-abc123' };

function setup(o: { connected?: boolean; xdotool?: boolean; reply?: (m: Message) => Message; search?: (args: string[], n: number) => string } = {}) {
  const registry = new Registry();
  registry.upsert(ws);
  const { conn, received } = fakeConnection(o.reply ?? ((m) => ({ type: 'openResult', id: (m as { id: string }).id, ok: true, title: 'App.tsx - project-a - Visual Studio Code' })));
  if (o.connected !== false) registry.attach(ws.workspaceId, conn);
  let searches = 0;
  let focused = '';
  const { exec, calls } = fakeExec((cmd, args) => {
    if (cmd === 'xdotool' && args[0] === 'search') return { stdout: o.search ? o.search(args, searches++) : '16777341\n' };
    if (cmd === 'xdotool' && args[0] === 'windowfocus') focused = args[2]!;
    if (cmd === 'xdotool' && args[0] === 'getactivewindow') return { stdout: `${Number(focused)}\n` };
    return undefined;
  });
  const raiser = o.xdotool === false ? undefined : new XdotoolRaiser({ exec, sleep: async () => {} });
  const opener = new Opener({ registry, exec, raiser: async () => raiser });
  return { opener, calls, received };
}

describe('Opener', () => {
  it('routes to the connected extension and raises the window with xdotool', async () => {
    const { opener, calls, received } = setup();
    const r = await opener.open({ workspaceId: 'abc123', cwd: '/w/project-a', target: 'src/App.tsx:42:8' });
    expect(r.via).toBe('extension');
    expect(received[0]).toMatchObject({ type: 'openRequest', path: '/w/project-a/src/App.tsx', line: 42, col: 8 });
    expect(calls[0]).toEqual({ cmd: 'xdotool', args: ['search', '--name', '^App\\.tsx - project-a - Visual Studio Code$'] });
    expect(calls.slice(1).map((c) => c.args[0])).toEqual(['windowactivate', 'windowraise', 'windowfocus', 'getactivewindow']);
    expect(calls[3]).toEqual({ cmd: 'xdotool', args: ['windowfocus', '--sync', '16777341'] });
    expect(r.raised).toBe(true);
  });

  it('falls back to code --goto for raising when xdotool is missing', async () => {
    const { opener, calls } = setup({ xdotool: false });
    await opener.open({ workspaceId: 'abc123', cwd: '/w/project-a', target: 'src/App.tsx:42' });
    expect(calls[0]).toEqual({ cmd: 'code', args: ['/w/project-a', '--goto', '/w/project-a/src/App.tsx:42'] });
  });

  it('uses the code CLI with the folder when the window is not connected', async () => {
    const { opener, calls, received } = setup({ connected: false });
    const r = await opener.open({ workspaceId: 'abc123', cwd: '/w/project-a', target: 'README.md' });
    expect(r.via).toBe('code-cli');
    expect(received).toEqual([]);
    expect(calls[0]).toEqual({ cmd: 'code', args: ['/w/project-a', '--goto', '/w/project-a/README.md'] });
  });

  it('uses plain code --goto when the workspace is unknown', async () => {
    const { opener, calls } = setup();
    const r = await opener.open({ cwd: '/elsewhere', target: 'x.ts:3:4' });
    expect(r.via).toBe('code-cli-fallback');
    expect(calls[0]).toEqual({ cmd: 'code', args: ['--goto', '/elsewhere/x.ts:3:4'] });
  });

  it('opens "." as the workspace window itself (focus only)', async () => {
    const { opener, calls, received } = setup();
    const r = await opener.open({ workspaceId: 'abc123', cwd: '/w/project-a/src', target: '.' });
    expect(r.via).toBe('extension');
    expect(received[0]).toMatchObject({ type: 'openRequest', path: '/w/project-a/src' });
    expect(calls[0]?.cmd).toBe('xdotool');
  });

  it('reports extension failures instead of throwing', async () => {
    const { opener } = setup({ reply: (m) => ({ type: 'openResult', id: (m as { id: string }).id, ok: false, error: 'boom' }) });
    await expect(opener.open({ workspaceId: 'abc123', cwd: '/w', target: 'a.ts' })).rejects.toThrow(/boom/);
  });
});

describe('Opener raise retries', () => {
  it('retries the exact title search while VS Code updates the window title', async () => {
    const { opener, calls } = setup({ search: (_a, n) => (n < 2 ? '' : '66\n') });
    const r = await opener.open({ workspaceId: 'abc123', cwd: '/w/project-a', target: 'src/App.tsx' });
    expect(r.raised).toBe(true);
    expect(calls.filter((c) => c.cmd === 'xdotool' && c.args[0] === 'search')).toHaveLength(3);
    expect(calls.find((c) => c.args[0] === 'windowfocus')).toEqual({ cmd: 'xdotool', args: ['windowfocus', '--sync', '66'] });
  });

  it('falls back to a workspace-name match when the exact title never appears and exactly one window matches', async () => {
    const { opener, calls } = setup({ search: (args) => (args[2]!.includes('project-a - ') && !args[2]!.startsWith('^App') ? '77\n' : '') });
    const r = await opener.open({ workspaceId: 'abc123', cwd: '/w/project-a', target: 'src/App.tsx' });
    expect(r.raised).toBe(true);
    expect(calls.find((c) => c.args[0] === 'windowfocus')).toEqual({ cmd: 'xdotool', args: ['windowfocus', '--sync', '77'] });
  });

  it('uses the code CLI when no window can be identified', async () => {
    const { opener, calls } = setup({ search: () => '' });
    const r = await opener.open({ workspaceId: 'abc123', cwd: '/w/project-a', target: 'src/App.tsx' });
    expect(r.raised).toBe(true); // code CLI exit 0
    expect(calls.at(-1)).toEqual({ cmd: 'code', args: ['/w/project-a', '--goto', '/w/project-a/src/App.tsx'] });
  });

  it('does not use an ambiguous workspace-name match', async () => {
    const { opener, calls } = setup({ search: (args) => (args[2]!.startsWith('^App') ? '' : '1\n2\n') });
    await opener.open({ workspaceId: 'abc123', cwd: '/w/project-a', target: 'src/App.tsx' });
    expect(calls.at(-1)?.cmd).toBe('code');
  });
});

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a.b*c (d) [e] {f} + ? ^ $ | \\')).toBe('a\\.b\\*c \\(d\\) \\[e\\] \\{f\\} \\+ \\? \\^ \\$ \\| \\\\');
  });
});

describe('Opener when the window never becomes active', () => {
  it('falls back to the code CLI', async () => {
    const registry = new Registry();
    registry.upsert(ws);
    const { conn } = fakeConnection((m) => ({ type: 'openResult', id: (m as { id: string }).id, ok: true, title: 'T' }));
    registry.attach(ws.workspaceId, conn);
    const { exec, calls } = fakeExec((cmd, args) => {
      if (cmd === 'xdotool' && args[0] === 'search') return { stdout: '5\n' };
      if (cmd === 'xdotool' && args[0] === 'getactivewindow') return { stdout: '9\n' };
      return undefined;
    });
    const opener = new Opener({ registry, exec, raiser: async () => new XdotoolRaiser({ exec, sleep: async () => {} }) });
    await opener.open({ workspaceId: 'abc123', cwd: '/w', target: 'a.ts' });
    expect(calls.at(-1)).toEqual({ cmd: 'code', args: ['/w/project-a', '--goto', '/w/a.ts'] });
  });
});

describe('Opener with a compositor raiser (KWin path)', () => {
  function kwinSetup(focused: boolean) {
    const registry = new Registry();
    registry.upsert(ws);
    const { conn, received } = fakeConnection((m) =>
      m.type === 'windowStateRequest'
        ? { type: 'result', id: m.id, ok: true, data: { focused } }
        : { type: 'openResult', id: (m as { id: string }).id, ok: true, title: 'T - project-a - Code' },
    );
    registry.attach(ws.workspaceId, conn);
    const seen: string[] = [];
    const raiser: WindowRaiser = {
      async raise(title, name, isFocused) {
        seen.push(`${title}|${name}`);
        return isFocused();
      },
    };
    const { exec, calls } = fakeExec();
    const opener = new Opener({ registry, exec, raiser: async () => raiser });
    return { opener, calls, received, seen };
  }

  it('verifies the raise by asking the extension for its window state', async () => {
    const { opener, calls, received, seen } = kwinSetup(true);
    const r = await opener.open({ workspaceId: 'abc123', cwd: '/w', target: 'a.ts' });
    expect(seen).toEqual(['T - project-a - Code|project-a']);
    expect(received.map((m) => m.type)).toEqual(['openRequest', 'windowStateRequest']);
    expect(r.raised).toBe(true);
    expect(calls).toEqual([]);
  });

  it('falls back to the code CLI when the window never reports focus', async () => {
    const { opener, calls } = kwinSetup(false);
    const r = await opener.open({ workspaceId: 'abc123', cwd: '/w', target: 'a.ts' });
    expect(calls).toEqual([{ cmd: 'code', args: ['/w/project-a', '--goto', '/w/a.ts'] }]);
    expect(r.raised).toBe(true); // code CLI exit 0
  });
});
