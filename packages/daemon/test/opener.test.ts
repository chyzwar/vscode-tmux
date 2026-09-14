import { describe, expect, it } from 'vitest';
import type { Message } from '@vscode-tmux/protocol';
import { Opener, escapeRegex } from '../src/opener.js';
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

function setup(o: { connected?: boolean; xdotool?: boolean; reply?: (m: Message) => Message } = {}) {
  const registry = new Registry();
  registry.upsert(ws);
  const { conn, received } = fakeConnection(o.reply ?? ((m) => ({ type: 'openResult', id: (m as { id: string }).id, ok: true, title: 'App.tsx - project-a - Visual Studio Code' })));
  if (o.connected !== false) registry.attach(ws.workspaceId, conn);
  const { exec, calls } = fakeExec((cmd, args) => (cmd === 'xdotool' && args[0] === 'search' ? { stdout: '0x100007d\n' } : undefined));
  const opener = new Opener({ registry, exec, xdotoolAvailable: async () => o.xdotool ?? true });
  return { opener, calls, received };
}

describe('Opener', () => {
  it('routes to the connected extension and raises the window with xdotool', async () => {
    const { opener, calls, received } = setup();
    const r = await opener.open({ workspaceId: 'abc123', cwd: '/w/project-a', target: 'src/App.tsx:42:8' });
    expect(r.via).toBe('extension');
    expect(received[0]).toMatchObject({ type: 'openRequest', path: '/w/project-a/src/App.tsx', line: 42, col: 8 });
    expect(calls[0]).toEqual({ cmd: 'xdotool', args: ['search', '--name', '^App\\.tsx - project-a - Visual Studio Code$'] });
    expect(calls[1]).toEqual({ cmd: 'xdotool', args: ['windowactivate', '--sync', '0x100007d'] });
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

describe('escapeRegex', () => {
  it('escapes regex metacharacters', () => {
    expect(escapeRegex('a.b*c (d) [e] {f} + ? ^ $ | \\')).toBe('a\\.b\\*c \\(d\\) \\[e\\] \\{f\\} \\+ \\? \\^ \\$ \\| \\\\');
  });
});
