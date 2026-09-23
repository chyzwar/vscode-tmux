import { readFileSync } from 'node:fs';
import * as z from 'zod';

/** Ghostty's `quick-terminal-size` syntax: `NN%` or `NNpx`, optionally `,` and a second value for the other axis. */
export const QuickTerminalSize = z.string().regex(/^\d+(px|%)(,\d+(px|%))?$/);
export const isQuickTerminalSize = (v: unknown): v is string => QuickTerminalSize.safeParse(v).success;

/**
 * `<configDir>/config.json`. A missing field takes its default; an invalid one
 * is an error (see `loadSettings`). Unknown keys are ignored.
 */
export const Settings = z.object({
  /**
   * GDK backend for the companion Ghostty instance.
   * `auto` (default): `x11` on GNOME, untouched elsewhere (so native Wayland under KWin and other
   * Wayland compositors, where Ghostty's fractional scaling, server-side decorations and quick
   * terminal work; the window's app-id is then the class `dev.vscodetmux.Ghostty`).
   * `x11`: run under XWayland. On GNOME 42 Wayland a Ghostty started by a background process never
   * creates its terminal surface when it runs natively on Wayland (see docs/e2e.md).
   * `wayland`: force native Wayland. `default`: never set GDK_BACKEND.
   */
  ghosttyGdkBackend: z.enum(['auto', 'x11', 'wayland', 'default']).default('auto'),
  /** Milliseconds to wait for Ghostty to attach its tmux client after launch. */
  ghosttyStartTimeoutMs: z.number().positive().default(8000),
  /**
   * The two `quick-terminal-size` values `vscode-tmux height` (F11) flips between.
   * The full height is pixels rather than 100% because Ghostty sizes the dropdown from the whole
   * monitor and sets no layer-shell exclusive zone, so 100% under a top Plasma panel pushes the
   * bottom of the terminal off screen. 1048 = 1080 minus a 32px panel; adjust to the screen.
   */
  ghosttyDropdownFull: QuickTerminalSize.default('1048px'),
  ghosttyDropdownShort: QuickTerminalSize.default('45%'),
});
export type Settings = z.infer<typeof Settings>;
export type GdkBackend = Settings['ghosttyGdkBackend'];

export const DEFAULT_SETTINGS: Settings = Settings.parse({});

/**
 * Read `<configDir>/config.json`. No file means the defaults. Anything else that
 * is wrong (unreadable, not JSON, not an object, a bad value) throws, naming the
 * file and the field: a typo in the config must not be silently ignored.
 */
export function loadSettings(file: string): Settings {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_SETTINGS };
    throw new Error(`cannot read ${file}: ${(err as Error).message}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${(err as Error).message}`);
  }
  const r = Settings.safeParse(raw);
  if (!r.success) throw new Error(`invalid settings in ${file}:\n${z.prettifyError(r.error)}`);
  return r.data;
}

/** `XDG_CURRENT_DESKTOP` is a colon-separated list, e.g. `ubuntu:GNOME`. */
export const isGnome = (env: NodeJS.ProcessEnv): boolean => (env.XDG_CURRENT_DESKTOP ?? '').split(':').some((d) => d.toUpperCase() === 'GNOME');

/** Environment additions for the Ghostty process derived from settings and the daemon's own environment. */
export function ghosttyEnvFor(settings: Settings, env: NodeJS.ProcessEnv): Record<string, string> {
  let backend = settings.ghosttyGdkBackend;
  if (backend === 'auto') backend = isGnome(env) ? 'x11' : 'default';
  return backend === 'default' ? {} : { GDK_BACKEND: backend };
}
