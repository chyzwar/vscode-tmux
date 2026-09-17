import { describe, expect, it } from 'vitest';
import { KWinRaiser, kwinAvailable, kwinRaiseScript } from '../src/raise/kwin.js';
import { fakeExec } from './fakeExec.js';

const TITLE = 'App.tsx - project-a - Visual Studio Code';

describe('kwinRaiseScript', () => {
  it('activates the exact title first, else an unambiguous workspace match', () => {
    const s = kwinRaiseScript(TITLE, 'project-a');
    expect(s).toContain(`new RegExp(${JSON.stringify('^App\\.tsx - project-a - Visual Studio Code$')})`);
    expect(s).toContain(`new RegExp(${JSON.stringify(' - project-a - ')})`);
    expect(s).toContain('workspace.windowList');
    expect(s).toContain('workspace.activeWindow = hit');
    expect(s).toContain('candidates.length === 1');
  });

  it('escapes regex metacharacters and quotes', () => {
    const s = kwinRaiseScript('a"b (c) - x.y - Code', 'x.y');
    expect(s).toContain(JSON.stringify('^a"b \\(c\\) - x\\.y - Code$'));
    expect(s).toContain(JSON.stringify(' - x\\.y - '));
  });

  // Execute the generated script against a fake KWin `workspace` (QJSEngine runs plain JS).
  type Win = { caption: string; normalWindow: boolean };
  const win = (caption: string, normalWindow = true): Win => ({ caption, normalWindow });
  function run(script: string, windows: Win[], plasma6 = true): Win | null {
    const workspace: { windowList?: () => Win[]; stackingOrder?: Win[]; activeWindow: Win | null } = { activeWindow: null };
    if (plasma6) workspace.windowList = () => windows;
    else workspace.stackingOrder = windows;
    new Function('workspace', script)(workspace);
    return workspace.activeWindow;
  }

  it('activates the exact title, ignoring non-normal windows', () => {
    const target = win(TITLE);
    const windows = [win('Plasma', false), win('README.md - project-a - Visual Studio Code'), target, win('VS Code Tmux')];
    expect(run(kwinRaiseScript(TITLE, 'project-a'), windows)).toBe(target);
  });

  it('falls back to the only window of the workspace when the exact title is not there yet', () => {
    const stale = win('README.md - project-a - Visual Studio Code');
    expect(run(kwinRaiseScript(TITLE, 'project-a'), [win('x - project-b - Visual Studio Code'), stale])).toBe(stale);
  });

  it('activates nothing when the workspace match is ambiguous or absent', () => {
    const script = kwinRaiseScript(TITLE, 'project-a');
    expect(run(script, [win('a - project-a - Visual Studio Code'), win('b - project-a - Visual Studio Code')])).toBeNull();
    expect(run(script, [win('a - project-b - Visual Studio Code')])).toBeNull();
    expect(run(script, [win(TITLE, false)])).toBeNull();
  });

  it('works with the stackingOrder property when windowList() is missing', () => {
    const target = win(TITLE);
    expect(run(kwinRaiseScript(TITLE, 'project-a'), [win('other'), target], false)).toBe(target);
  });
});

function setup(o: { loadId?: number; focused?: () => boolean; busctlMissing?: boolean } = {}) {
  const written: { path: string; content: string }[] = [];
  const { exec, calls } = fakeExec((cmd, args) => {
    if (cmd !== 'busctl') return undefined;
    if (o.busctlMissing) return { code: 127, stderr: 'spawn busctl ENOENT' };
    if (args.includes('loadScript')) return { stdout: JSON.stringify({ type: 'i', data: [o.loadId ?? 7] }) + '\n' };
    if (args.includes('unloadScript')) return { stdout: 'b true\n' };
    return {};
  });
  let polls = 0;
  const isFocused = async () => {
    polls++;
    return o.focused ? o.focused() : true;
  };
  const logs: string[] = [];
  const raiser = new KWinRaiser({
    exec,
    scriptPath: '/state/kwin-raise.js',
    writeScript: (path, content) => written.push({ path, content }),
    sleep: async () => {},
    log: (l) => logs.push(l),
    attempts: 3,
    verifyAttempts: 2,
  });
  return { raiser, calls, written, isFocused, polls: () => polls, logs };
}

const busctl = (calls: { cmd: string; args: string[] }[]) => calls.filter((c) => c.cmd === 'busctl').map((c) => c.args);

describe('KWinRaiser', () => {
  it('writes the script, loads and runs it through busctl, verifies focus, then unloads', async () => {
    const { raiser, calls, written, isFocused } = setup();
    expect(await raiser.raise(TITLE, 'project-a', isFocused)).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0]!.path).toBe('/state/kwin-raise.js');
    expect(written[0]!.content).toBe(kwinRaiseScript(TITLE, 'project-a'));
    expect(busctl(calls)).toEqual([
      ['--user', 'call', 'org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', 's', 'vscode-tmux-raise'],
      ['--user', '--json=short', 'call', 'org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'loadScript', 'ss', '/state/kwin-raise.js', 'vscode-tmux-raise'],
      ['--user', 'call', 'org.kde.KWin', '/Scripting/Script7', 'org.kde.kwin.Script', 'run'],
      ['--user', 'call', 'org.kde.KWin', '/Scripting', 'org.kde.kwin.Scripting', 'unloadScript', 's', 'vscode-tmux-raise'],
    ]);
  });

  it('re-runs the script while the window does not take focus, then gives up', async () => {
    let n = 0;
    const { raiser, calls, isFocused, polls } = setup({ focused: () => ++n >= 4 });
    expect(await raiser.raise(TITLE, 'project-a', isFocused)).toBe(true);
    // attempt 1: 2 polls (false, false); attempt 2: 2 polls (false, true)
    expect(polls()).toBe(4);
    expect(busctl(calls).filter((a) => a.includes('run'))).toHaveLength(2);

    const failing = setup({ focused: () => false });
    expect(await failing.raiser.raise(TITLE, 'project-a', failing.isFocused)).toBe(false);
    expect(busctl(failing.calls).filter((a) => a.includes('run'))).toHaveLength(3);
    expect(failing.polls()).toBe(6);
    expect(failing.logs.at(-1)).toMatch(/did not take focus/);
  });

  it('fails without running when KWin refuses to load the script', async () => {
    const { raiser, calls, isFocused, polls, logs } = setup({ loadId: -1 });
    expect(await raiser.raise(TITLE, 'project-a', isFocused)).toBe(false);
    expect(busctl(calls).some((a) => a.includes('run'))).toBe(false);
    expect(polls()).toBe(0);
    expect(logs.join('\n')).toMatch(/loadScript/);
  });

  it('fails cleanly when busctl is missing', async () => {
    const { raiser, isFocused, polls } = setup({ busctlMissing: true });
    expect(await raiser.raise(TITLE, 'project-a', isFocused)).toBe(false);
    expect(polls()).toBe(0);
  });

  it('serializes concurrent raises (one script file, one KWin plugin name)', async () => {
    const { raiser, calls, isFocused } = setup();
    await Promise.all([raiser.raise('A - p - Code', 'p', isFocused), raiser.raise('B - q - Code', 'q', isFocused)]);
    const seq = busctl(calls).map((a) => a[a.indexOf('call') + 4]);
    expect(seq).toEqual(['unloadScript', 'loadScript', 'run', 'unloadScript', 'unloadScript', 'loadScript', 'run', 'unloadScript']);
  });
});

describe('kwinAvailable', () => {
  it('is true when org.kde.KWin owns a name on the session bus', async () => {
    const { exec, calls } = fakeExec((cmd, args) => (cmd === 'busctl' && args.includes('status') ? { code: 0 } : { code: 1 }));
    expect(await kwinAvailable(exec)).toBe(true);
    expect(calls[0]).toEqual({ cmd: 'busctl', args: ['--user', 'status', 'org.kde.KWin'] });
  });

  it('is false when the name is not owned or busctl is missing', async () => {
    expect(await kwinAvailable(fakeExec(() => ({ code: 1 })).exec)).toBe(false);
    expect(await kwinAvailable(fakeExec(() => ({ code: 127 })).exec)).toBe(false);
  });
});
