import { readFileSync } from 'node:fs';

export interface Settings {
  /**
   * GDK backend for the companion Ghostty instance.
   * `x11` (default): run under XWayland. On GNOME 42 Wayland a Ghostty started by a
   * background process never creates its terminal surface when it runs natively on
   * Wayland (see docs/e2e.md), and an X11 window can be raised with xdotool.
   * `wayland`: native Wayland (works on compositors such as KWin).
   * `default`: leave GDK_BACKEND untouched.
   */
  ghosttyGdkBackend: 'x11' | 'wayland' | 'default';
  /** Seconds to wait for Ghostty to attach its tmux client after launch. */
  ghosttyStartTimeoutMs: number;
}

export const DEFAULT_SETTINGS: Settings = { ghosttyGdkBackend: 'x11', ghosttyStartTimeoutMs: 8000 };

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
    if (r.ghosttyGdkBackend === 'x11' || r.ghosttyGdkBackend === 'wayland' || r.ghosttyGdkBackend === 'default') s.ghosttyGdkBackend = r.ghosttyGdkBackend;
    if (typeof r.ghosttyStartTimeoutMs === 'number' && r.ghosttyStartTimeoutMs > 0) s.ghosttyStartTimeoutMs = r.ghosttyStartTimeoutMs;
  }
  return s;
}

/** Environment additions for the Ghostty process derived from settings. */
export function ghosttyEnvFor(settings: Settings): Record<string, string> {
  return settings.ghosttyGdkBackend === 'default' ? {} : { GDK_BACKEND: settings.ghosttyGdkBackend };
}
