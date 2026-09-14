import { describe, expect, it } from 'vitest';
import { TmuxBackend } from '../src/backend/tmux.js';
import { argsOf, fakeExec } from './fakeExec.js';

const make = (respond?: Parameters<typeof fakeExec>[0]) => {
  const { exec, calls } = fakeExec(respond);
  const backend = new TmuxBackend({ exec, socketName: 'vst-test', configPath: '/cfg/tmux.conf', env: { PATH: '/usr/bin' } });
  return { backend, calls };
};

describe('TmuxBackend argv', () => {
  it('starts the server with the isolated socket and config', async () => {
    const { backend, calls } = make();
    await backend.ensureServer();
    expect(calls[0]).toEqual({ cmd: 'tmux', args: ['-L', 'vst-test', '-f', '/cfg/tmux.conf', 'start-server'] });
  });

  it('hasSession uses exact-match targets and maps exit code', async () => {
    const { backend, calls } = make((_c, a) => (a.includes('has-session') ? { code: 1 } : undefined));
    expect(await backend.hasSession('proj-1234')).toBe(false);
    expect(argsOf(calls, 'has-session')).toEqual(['-L', 'vst-test', 'has-session', '-t', '=proj-1234']);
  });

  it('createSession passes name, first window, cwd and env', async () => {
    const { backend, calls } = make();
    await backend.createSession({ name: 'proj-1234', cwd: '/p', env: { A: '1', B: 'two' }, firstTabName: 'Shell' });
    expect(argsOf(calls, 'new-session')).toEqual([
      '-L', 'vst-test', '-f', '/cfg/tmux.conf', 'new-session', '-d', '-s', 'proj-1234', '-n', 'Shell', '-c', '/p', '-e', 'A=1', '-e', 'B=two',
    ]);
  });

  it('listTabs parses tab-separated list-windows output', async () => {
    const { backend } = make((_c, a) =>
      a.includes('list-windows') ? { stdout: '@1<|>0<|>Shell<|>0<|>/p<|>bash\n@3<|>1<|>Server<|>1<|>/p/api<|>node\n' } : undefined,
    );
    expect(await backend.listTabs('proj-1234')).toEqual([
      { id: '@1', index: 0, name: 'Shell', cwd: '/p', active: false, command: 'bash' },
      { id: '@3', index: 1, name: 'Server', cwd: '/p/api', active: true, command: 'node' },
    ]);
  });

  it('newTab creates a window with name, cwd, optional command and returns it', async () => {
    const { backend, calls } = make((_c, a) => {
      if (a.includes('new-window')) return { stdout: '@7\n' };
      if (a.includes('list-windows')) return { stdout: '@1<|>0<|>Shell<|>0<|>/p<|>bash\n@7<|>1<|>Server<|>1<|>/p<|>npm\n' };
      return undefined;
    });
    const tab = await backend.newTab('proj-1234', { name: 'Server', cwd: '/p', command: ['npm', 'run', 'dev'] });
    expect(argsOf(calls, 'new-window')).toEqual([
      '-L', 'vst-test', 'new-window', '-t', '=proj-1234:', '-n', 'Server', '-c', '/p', '-P', '-F', '#{window_id}', 'npm', 'run', 'dev',
    ]);
    expect(tab).toEqual({ id: '@7', index: 1, name: 'Server', cwd: '/p', active: true, command: 'npm' });
  });

  it('listClients parses clients including control-mode ones', async () => {
    const { backend } = make((_c, a) =>
      a.includes('list-clients')
        ? { stdout: '/dev/pts/7<|>xterm-ghostty<|>0<|>proj-1234<|>4242\n/dev/pts/9<|>tmux-256color<|>1<|>lobby<|>4300\n' }
        : undefined,
    );
    expect(await backend.listClients()).toEqual([
      { tty: '/dev/pts/7', termname: 'xterm-ghostty', control: false, session: 'proj-1234', pid: 4242 },
      { tty: '/dev/pts/9', termname: 'tmux-256color', control: true, session: 'lobby', pid: 4300 },
    ]);
  });

  it('switchClient targets the client tty and exact session, skipping update-environment', async () => {
    const { backend, calls } = make();
    await backend.switchClient('/dev/pts/7', 'proj-1234');
    expect(argsOf(calls, 'switch-client')).toEqual(['-L', 'vst-test', 'switch-client', '-E', '-c', '/dev/pts/7', '-t', '=proj-1234']);
  });

  it('switchClient throws on tmux error', async () => {
    const { backend } = make((_c, a) => (a.includes('switch-client') ? { code: 1, stderr: 'no such client' } : undefined));
    await expect(backend.switchClient('/dev/pts/7', 'proj-1234')).rejects.toThrow(/no such client/);
  });

  it('listSessions returns [] when the server is not running', async () => {
    const { backend } = make((_c, a) => (a.includes('list-sessions') ? { code: 1, stderr: 'no server running' } : undefined));
    expect(await backend.listSessions()).toEqual([]);
  });

  it('selectTab selects a window by id', async () => {
    const { backend, calls } = make();
    await backend.selectTab('proj-1234', '@7');
    expect(argsOf(calls, 'select-window')).toEqual(['-L', 'vst-test', 'select-window', '-t', '=proj-1234:@7']);
  });

  it('attachCommand yields the argv Ghostty should run', () => {
    const { backend } = make();
    expect(backend.attachCommand('lobby')).toEqual(['tmux', '-L', 'vst-test', '-f', '/cfg/tmux.conf', 'new-session', '-A', '-s', 'lobby']);
  });
});
