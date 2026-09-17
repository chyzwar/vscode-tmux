import { readFileSync } from 'node:fs';

export type GdkBackend = 'auto' | 'x11' | 'wayland' | 'default';

export interface Settings {
  /**
   * GDK backend for the companion Ghostty instance.
   * `auto` (default): `x11` on GNOME, untouched elsewhere (so native Wayland under KWin and other
   * Wayland compositors, where Ghostty's fractional scaling, server-side decorations and quick
   * terminal work; the window's app-id is then the class `dev.vscodetmux.Ghostty`).
   * `x11`: run under XWayland. On GNOME 42 Wayland a Ghostty started by a background process never
   * creates its terminal surface when it runs natively on Wayland (see docs/e2e.md).
   * `wayland`: force native Wayland. `default`: never set GDK_BACKEND.
   */
  ghosttyGdkBackend: GdkBackend;
  /** Milliseconds to wait for Ghostty to attach its tmux client after launch. */
  ghosttyStartTimeoutMs: number;
}

export const DEFAULT_SETTINGS: Settings = { ghosttyGdkBackend: 'auto', ghosttyStartTimeoutMs: 8000 };

const BACKENDS: ReadonlySet<string> = new Set<GdkBackend>(['auto', 'x11', 'wayland', 'default']);

/** Read `<configDir>/config.json`; missing file or unknown keys are fine, bad values fall back to defaults. */
export function loadSettings(file: string): Settings {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  const s = { ...DEFAULT_SETTINGS };
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>;
    if (typeof r.ghosttyGdkBackend === 'string' && BACKENDS.has(r.ghosttyGdkBackend)) s.ghosttyGdkBackend = r.ghosttyGdkBackend as GdkBackend;
    if (typeof r.ghosttyStartTimeoutMs === 'number' && r.ghosttyStartTimeoutMs > 0) s.ghosttyStartTimeoutMs = r.ghosttyStartTimeoutMs;
  }
  return s;
}

/** `XDG_CURRENT_DESKTOP` is a colon-separated list, e.g. `ubuntu:GNOME`. */
export const isGnome = (env: NodeJS.ProcessEnv): boolean => (env.XDG_CURRENT_DESKTOP ?? '').split(':').some((d) => d.toUpperCase() === 'GNOME');

/** Environment additions for the Ghostty process derived from settings and the daemon's own environment. */
export function ghosttyEnvFor(settings: Settings, env: NodeJS.ProcessEnv): Record<string, string> {
  let backend = settings.ghosttyGdkBackend;
  if (backend === 'auto') backend = isGnome(env) ? 'x11' : 'default';
  return backend === 'default' ? {} : { GDK_BACKEND: backend };
}
