import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, ghosttyEnvFor, loadSettings } from '../src/settings.js';

describe('settings', () => {
  it('defaults to auto: XWayland on GNOME, the compositor default elsewhere', () => {
    expect(loadSettings('/nonexistent/config.json')).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.ghosttyGdkBackend).toBe('auto');
    expect(ghosttyEnvFor(DEFAULT_SETTINGS, { XDG_CURRENT_DESKTOP: 'GNOME' })).toEqual({ GDK_BACKEND: 'x11' });
    expect(ghosttyEnvFor(DEFAULT_SETTINGS, { XDG_CURRENT_DESKTOP: 'ubuntu:GNOME' })).toEqual({ GDK_BACKEND: 'x11' });
    expect(ghosttyEnvFor(DEFAULT_SETTINGS, { XDG_CURRENT_DESKTOP: 'KDE' })).toEqual({});
    expect(ghosttyEnvFor(DEFAULT_SETTINGS, {})).toEqual({});
  });

  it('reads overrides and ignores bad values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vst-cfg-'));
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ ghosttyGdkBackend: 'wayland', ghosttyStartTimeoutMs: -5, extra: 1 }));
    const s = loadSettings(file);
    expect(s).toEqual({ ghosttyGdkBackend: 'wayland', ghosttyStartTimeoutMs: 8000 });
    expect(ghosttyEnvFor(s, { XDG_CURRENT_DESKTOP: 'GNOME' })).toEqual({ GDK_BACKEND: 'wayland' });
    expect(ghosttyEnvFor({ ...s, ghosttyGdkBackend: 'x11' }, { XDG_CURRENT_DESKTOP: 'KDE' })).toEqual({ GDK_BACKEND: 'x11' });
    expect(ghosttyEnvFor({ ...s, ghosttyGdkBackend: 'default' }, { XDG_CURRENT_DESKTOP: 'GNOME' })).toEqual({});
    writeFileSync(file, JSON.stringify({ ghosttyGdkBackend: 'sdl' }));
    expect(loadSettings(file).ghosttyGdkBackend).toBe('auto');
  });
});
