import { describe, expect, it } from 'vitest';
import { scrubEnv } from '../src/env.js';

describe('scrubEnv', () => {
  it('drops editor/terminal nesting variables', () => {
    const out = scrubEnv({ TMUX: '/tmp/x', TMUX_PANE: '%1', TERM_PROGRAM: 'vscode', VSCODE_PID: '1', GHOSTTY_RESOURCES_DIR: '/r', PATH: '/usr/bin' });
    expect(out).toEqual({ PATH: '/usr/bin:/usr/local/bin:/bin:/snap/bin', LANG: 'C.UTF-8' });
  });

  it('removes variables that point into the VS Code snap and their _VSCODE_SNAP_ORIG companions', () => {
    const out = scrubEnv({
      GTK_PATH: '/snap/code/255/usr/lib/x86_64-linux-gnu/gtk-3.0',
      GTK_PATH_VSCODE_SNAP_ORIG: '/snap/code/255/usr/lib/x86_64-linux-gnu/gtk-3.0',
      GIO_MODULE_DIR: '/home/u/snap/code/common/.cache/gio-modules',
      LOCPATH: '/snap/code/255/usr/lib/locale',
      GDK_BACKEND: 'x11',
      XDG_DATA_DIRS: '/home/u/snap/code/255/.local/share:/snap/code/255:/usr/share:/usr/local/share',
      XDG_CONFIG_DIRS: '/etc/xdg',
      LANG: 'en_US.UTF-8',
    });
    expect(out).toEqual({ XDG_DATA_DIRS: '/usr/share:/usr/local/share', XDG_CONFIG_DIRS: '/etc/xdg', LANG: 'en_US.UTF-8', PATH: '/usr/local/bin:/usr/bin:/bin:/snap/bin' });
  });

  it('keeps desktop session variables and PATH entries outside the snap', () => {
    const out = scrubEnv({
      DISPLAY: ':0',
      WAYLAND_DISPLAY: 'wayland-0',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x',
      XDG_RUNTIME_DIR: '/run/user/1',
      HOME: '/h',
      SHELL: '/bin/zsh',
      LC_ALL: 'C',
      PATH: '/snap/code/255/usr/bin:/home/u/.local/bin:/usr/bin',
    });
    expect(out).toEqual({
      DISPLAY: ':0',
      WAYLAND_DISPLAY: 'wayland-0',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/x',
      XDG_RUNTIME_DIR: '/run/user/1',
      HOME: '/h',
      SHELL: '/bin/zsh',
      LC_ALL: 'C',
      PATH: '/home/u/.local/bin:/usr/bin:/h/.local/bin:/usr/local/bin:/bin:/snap/bin',
    });
  });
});

describe('withStandardDirs', () => {
  it('appends missing standard dirs once, keeping order', async () => {
    const { withStandardDirs } = await import('../src/env.js');
    expect(withStandardDirs('/snap/bin:/opt/x', '/h')).toBe('/snap/bin:/opt/x:/h/.local/bin:/usr/local/bin:/usr/bin:/bin');
  });
});
