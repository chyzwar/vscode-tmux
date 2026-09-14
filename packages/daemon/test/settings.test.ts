import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, ghosttyEnvFor, loadSettings } from '../src/settings.js';

describe('settings', () => {
  it('defaults to X11 for Ghostty when there is no config file', () => {
    expect(loadSettings('/nonexistent/config.json')).toEqual(DEFAULT_SETTINGS);
    expect(ghosttyEnvFor(DEFAULT_SETTINGS)).toEqual({ GDK_BACKEND: 'x11' });
  });

  it('reads overrides and ignores bad values', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vst-cfg-'));
    const file = join(dir, 'config.json');
    writeFileSync(file, JSON.stringify({ ghosttyGdkBackend: 'wayland', ghosttyStartTimeoutMs: -5, extra: 1 }));
    const s = loadSettings(file);
    expect(s).toEqual({ ghosttyGdkBackend: 'wayland', ghosttyStartTimeoutMs: 8000 });
    expect(ghosttyEnvFor(s)).toEqual({ GDK_BACKEND: 'wayland' });
    expect(ghosttyEnvFor({ ...s, ghosttyGdkBackend: 'default' })).toEqual({});
  });
});
