import { describe, expect, it } from 'vitest';
import { fakeExec } from './fakeExec.js';
import {
  appObjectPath,
  currentQuickTerminalSize,
  parseBusName,
  parseWindowPaths,
  toggleDropdownHeight,
  withQuickTerminalSize,
} from '../src/dropdown.js';

const APP = 'dev.vscodetmux.Ghostty';
const UNIT = 'app-dev.vscodetmux.Ghostty.service';

const BUS_LIST = [
  ':1.12                                        2001 plasmashell     raziel :1.12         plasma-plasmashell.service - -',
  ':1.506                                       77310 ghostty         raziel :1.506        user@1000.service - -',
  'org.kde.KWin                                 1999 kwin_wayland    raziel :1.4          plasma-kwin_wayland.service - -',
  '',
].join('\n');

const TREE_WITH_WINDOW = `└─ /dev
  └─ /dev/vscodetmux
    └─ /dev/vscodetmux/Ghostty
      └─ /dev/vscodetmux/Ghostty/window
        └─ /dev/vscodetmux/Ghostty/window/11
`;
const TREE_NO_WINDOW = `└─ /dev
  └─ /dev/vscodetmux
    └─ /dev/vscodetmux/Ghostty
`;

describe('appObjectPath', () => {
  it('is the application id with slashes', () => {
    expect(appObjectPath(APP)).toBe('/dev/vscodetmux/Ghostty');
  });
});

describe('parseBusName', () => {
  it('finds the unique connection name owned by the pid', () => {
    expect(parseBusName(BUS_LIST, 77310)).toBe(':1.506');
  });
  it('skips well-known names and unknown pids', () => {
    expect(parseBusName(BUS_LIST, 1999)).toBeUndefined();
    expect(parseBusName(BUS_LIST, 1)).toBeUndefined();
  });
});

describe('parseWindowPaths', () => {
  it('reads window objects out of the busctl tree', () => {
    expect(parseWindowPaths(TREE_WITH_WINDOW, '/dev/vscodetmux/Ghostty')).toEqual(['/dev/vscodetmux/Ghostty/window/11']);
  });
  it('ignores the window container itself', () => {
    expect(parseWindowPaths(TREE_NO_WINDOW, '/dev/vscodetmux/Ghostty')).toEqual([]);
    expect(parseWindowPaths(TREE_WITH_WINDOW.replace('/window/11', ''), '/dev/vscodetmux/Ghostty')).toEqual([]);
  });
});

describe('quick-terminal-size in the config', () => {
  it('replaces the existing line in place and leaves the rest alone', () => {
    const conf = '# dropdown\nquick-terminal-position = top\nquick-terminal-size = 45%\nquick-terminal-autohide = false\n';
    expect(withQuickTerminalSize(conf, '1048px')).toBe(conf.replace('45%', '1048px'));
    expect(currentQuickTerminalSize(conf)).toBe('45%');
  });
  it('appends a line when there is none', () => {
    expect(withQuickTerminalSize('title = x', '45%')).toBe('title = x\nquick-terminal-size = 45%\n');
    expect(currentQuickTerminalSize('title = x')).toBeUndefined();
  });
});

/** A companion that is up with one window; the window is gone after `close`. */
function liveCompanion(size: string) {
  const files: Record<string, string> = { '/cfg/ghostty.conf': `quick-terminal-size = ${size}\n` };
  let closed = false;
  const { exec, calls } = fakeExec((cmd, args) => {
    if (cmd === 'systemctl' && args.includes('MainPID')) return { stdout: '77310\n' };
    if (cmd !== 'busctl') return undefined;
    if (args[1] === 'list') return { stdout: BUS_LIST };
    if (args[1] === 'tree') return { stdout: closed ? TREE_NO_WINDOW : TREE_WITH_WINDOW };
    if (args[1] === 'call' && args[7] === 'close') closed = true;
    if (args[1] === 'call' && args[5] === 'shortcutNames') return { stdout: 'as 1 "CTRL+grave"\n' };
    return {};
  });
  const opts = {
    exec,
    unit: UNIT,
    appClass: APP,
    configPath: '/cfg/ghostty.conf',
    full: '1048px',
    short: '45%',
    readFile: (p: string) => files[p]!,
    writeFile: (p: string, t: string) => void (files[p] = t),
    sleep: async () => {},
  };
  return { opts, calls, files };
}

describe('toggleDropdownHeight', () => {
  it('goes short → full: writes the size, reloads, closes the window, presses ctrl+`', async () => {
    const { opts, calls, files } = liveCompanion('45%');
    expect(await toggleDropdownHeight(opts)).toEqual({ size: '1048px', state: 'rebuilt' });
    expect(files['/cfg/ghostty.conf']).toBe('quick-terminal-size = 1048px\n');
    const busCalls = calls.filter((c) => c.cmd === 'busctl' && c.args[1] === 'call').map((c) => c.args);
    expect(busCalls[0]).toEqual(['--user', 'call', ':1.506', '/dev/vscodetmux/Ghostty', 'org.gtk.Actions', 'Activate', 'sava{sv}', 'reload-config', '0', '0']);
    expect(busCalls[1]).toEqual(['--user', 'call', ':1.506', '/dev/vscodetmux/Ghostty/window/11', 'org.gtk.Actions', 'Activate', 'sava{sv}', 'close', '0', '0']);
    expect(busCalls.at(-1)?.slice(5)).toEqual(['invokeShortcut', 's', 'CTRL+grave']);
  });

  it('goes full → short, and anything else → full', async () => {
    expect((await toggleDropdownHeight(liveCompanion('1048px').opts)).size).toBe('45%');
    expect((await toggleDropdownHeight(liveCompanion('60%').opts)).size).toBe('1048px');
  });

  it('only writes the config when the companion is not running', async () => {
    const { opts, calls, files } = liveCompanion('45%');
    const { exec } = fakeExec((cmd) => (cmd === 'systemctl' ? { stdout: '0\n' } : undefined));
    expect(await toggleDropdownHeight({ ...opts, exec })).toEqual({ size: '1048px', state: 'not-running' });
    expect(files['/cfg/ghostty.conf']).toBe('quick-terminal-size = 1048px\n');
    expect(calls).toEqual([]);
  });

  it('stops after the reload when no window is open', async () => {
    const { opts, calls } = liveCompanion('45%');
    const base = opts.exec;
    const exec: typeof base = (cmd, args) => (cmd === 'busctl' && args[1] === 'tree' ? Promise.resolve({ code: 0, stdout: TREE_NO_WINDOW, stderr: '' }) : base(cmd, args));
    expect(await toggleDropdownHeight({ ...opts, exec })).toEqual({ size: '1048px', state: 'no-window' });
    expect(calls.some((c) => c.args.includes('close'))).toBe(false);
    expect(calls.some((c) => c.args.includes('invokeShortcut'))).toBe(false);
  });

  it('reports a closed window it could not reopen when no shortcut is registered', async () => {
    const { opts } = liveCompanion('45%');
    const base = opts.exec;
    const exec: typeof base = (cmd, args) =>
      cmd === 'busctl' && (args[5] === 'shortcutNames' || args[5] === 'allComponents') ? Promise.resolve({ code: 1, stdout: '', stderr: 'no such object' }) : base(cmd, args);
    expect(await toggleDropdownHeight({ ...opts, exec })).toEqual({ size: '1048px', state: 'closed' });
  });
});
