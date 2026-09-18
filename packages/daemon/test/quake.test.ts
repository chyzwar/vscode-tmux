import { describe, expect, it } from 'vitest';
import { fakeExec } from './fakeExec.js';
import { componentPathFor, findQuakeShortcut, parseStringArray, toggleQuake } from '../src/quake.js';

describe('componentPathFor', () => {
  it('folds the application id the way kglobalaccel names components', () => {
    expect(componentPathFor('dev.vscodetmux.Ghostty')).toBe('/component/dev_vscodetmux_Ghostty');
  });
});

describe('parseStringArray', () => {
  it('reads a busctl string array', () => {
    expect(parseStringArray('as 2 "CTRL+grave" "CTRL+ALT+t"')).toEqual(['CTRL+grave', 'CTRL+ALT+t']);
  });
  it('is empty for an empty array', () => {
    expect(parseStringArray('as 0')).toEqual([]);
  });
});

describe('findQuakeShortcut', () => {
  it('picks the backtick binding out of the registered shortcuts', async () => {
    const { exec } = fakeExec((cmd) => (cmd === 'busctl' ? { code: 0, stdout: 'as 2 "CTRL+ALT+t" "CTRL+grave"\n', stderr: '' } : undefined));
    expect(await findQuakeShortcut(exec, 'dev.vscodetmux.Ghostty')).toEqual({ component: '/component/dev_vscodetmux_Ghostty', action: 'CTRL+grave' });
  });

  it('is undefined when the desktop registered nothing (no kglobalaccel, or shortcut denied)', async () => {
    const { exec } = fakeExec((cmd) => (cmd === 'busctl' ? { code: 1, stdout: '', stderr: 'No such object path' } : undefined));
    expect(await findQuakeShortcut(exec, 'dev.vscodetmux.Ghostty')).toBeUndefined();
  });
});

describe('toggleQuake', () => {
  it('invokes the shortcut through kglobalaccel', async () => {
    const { exec, calls } = fakeExec((cmd) => (cmd === 'busctl' ? { code: 0, stdout: 'as 1 "CTRL+grave"\n', stderr: '' } : undefined));
    await toggleQuake(exec, 'dev.vscodetmux.Ghostty');
    expect(calls[1]!.args).toEqual([
      '--user', 'call', 'org.kde.kglobalaccel', '/component/dev_vscodetmux_Ghostty',
      'org.kde.kglobalaccel.Component', 'invokeShortcut', 's', 'CTRL+grave',
    ]);
  });
});
