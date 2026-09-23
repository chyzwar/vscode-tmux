import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, ghosttyEnvFor, isQuickTerminalSize, loadSettings } from '../src/settings.js';

const configFile = (text: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), 'vst-cfg-')), 'config.json');
  writeFileSync(file, text);
  return file;
};

describe('settings', () => {
  it('defaults to auto: XWayland on GNOME, the compositor default elsewhere', () => {
    expect(loadSettings('/nonexistent/config.json')).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.ghosttyGdkBackend).toBe('auto');
    expect(ghosttyEnvFor(DEFAULT_SETTINGS, { XDG_CURRENT_DESKTOP: 'GNOME' })).toEqual({ GDK_BACKEND: 'x11' });
    expect(ghosttyEnvFor(DEFAULT_SETTINGS, { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toEqual({ GDK_BACKEND: 'x11' });
    expect(ghosttyEnvFor(DEFAULT_SETTINGS, { XDG_CURRENT_DESKTOP: 'KDE' })).toEqual({});
    expect(ghosttyEnvFor(DEFAULT_SETTINGS, {})).toEqual({});
  });

  it('reads overrides, fills in missing fields, and ignores unknown keys', () => {
    const s = loadSettings(configFile(JSON.stringify({ ghosttyGdkBackend: 'wayland', ghosttyDropdownFull: '100%,100%', extra: 1 })));
    expect(s).toEqual({ ghosttyGdkBackend: 'wayland', ghosttyStartTimeoutMs: 8000, ghosttyDropdownFull: '100%,100%', ghosttyDropdownShort: '45%' });
    expect(ghosttyEnvFor(s, { XDG_CURRENT_DESKTOP: 'GNOME' })).toEqual({ GDK_BACKEND: 'wayland' });
    expect(ghosttyEnvFor({ ...s, ghosttyGdkBackend: 'x11' }, { XDG_CURRENT_DESKTOP: 'KDE' })).toEqual({ GDK_BACKEND: 'x11' });
    expect(ghosttyEnvFor({ ...s, ghosttyGdkBackend: 'default' }, { XDG_CURRENT_DESKTOP: 'GNOME' })).toEqual({});
    expect(loadSettings(configFile('{}'))).toEqual(DEFAULT_SETTINGS);
  });

  it('throws on a bad value, naming the file and the field', () => {
    expect(() => loadSettings(configFile(JSON.stringify({ ghosttyGdkBackend: 'sdl' })))).toThrow(/invalid settings in .*config\.json[\s\S]*ghosttyGdkBackend/);
    expect(() => loadSettings(configFile(JSON.stringify({ ghosttyStartTimeoutMs: -5 })))).toThrow(/ghosttyStartTimeoutMs/);
    expect(() => loadSettings(configFile(JSON.stringify({ ghosttyDropdownShort: 'small' })))).toThrow(/ghosttyDropdownShort/);
  });

  it('throws on a file that is not JSON or not an object', () => {
    expect(() => loadSettings(configFile('{ nope'))).toThrow(/is not valid JSON/);
    for (const text of ['[]', '42', '"x"', 'null']) expect(() => loadSettings(configFile(text))).toThrow(/invalid settings/);
  });

  it('throws on a file it cannot read, but not on a missing one', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vst-cfg-'));
    mkdirSync(join(dir, 'config.json'));
    expect(() => loadSettings(join(dir, 'config.json'))).toThrow(/cannot read/);
    expect(loadSettings(join(dir, 'missing.json'))).toEqual(DEFAULT_SETTINGS);
  });

  it('accepts Ghostty size syntax only', () => {
    for (const ok of ['45%', '1048px', '100%,100%', '50%,500px']) expect(isQuickTerminalSize(ok)).toBe(true);
    for (const bad of ['45', 'full', '', '45%,', 4, undefined]) expect(isQuickTerminalSize(bad)).toBe(false);
  });
});
