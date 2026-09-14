/**
 * Environment hygiene shared by the daemon and the extension.
 *
 * Processes we spawn (tmux server, Ghostty, shells inside sessions) must see a
 * normal desktop environment. Two things pollute it:
 *  - the VS Code snap wrapper points GTK/GIO/locale paths into the snap
 *    (GTK_PATH, GIO_MODULE_DIR, LOCPATH, GSETTINGS_SCHEMA_DIR, XDG_DATA_DIRS,
 *    GDK_BACKEND) and leaves `<NAME>_VSCODE_SNAP_ORIG` companions behind;
 *  - terminal/editor specific variables (TMUX, TERM_PROGRAM, VSCODE_*, GHOSTTY_*)
 *    would make tmux or Ghostty think they run nested.
 * Everything else (DISPLAY, WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS, PATH,
 * locale, XDG_RUNTIME_DIR) is kept, because GTK needs it.
 */
const DROP_EXACT = new Set(['TMUX', 'TMUX_PANE', 'TERM_PROGRAM', 'TERM_PROGRAM_VERSION', 'NODE_OPTIONS', 'CHROME_DESKTOP', 'ELECTRON_RUN_AS_NODE', 'ORIGINAL_XDG_CURRENT_DESKTOP', 'INIT_CWD', 'PROJECT_CWD', 'GDK_BACKEND']);
const DROP_PREFIXES = ['VSCODE_', 'GHOSTTY_', 'ELECTRON_', 'npm_', 'YARN_', 'COREPACK_', 'BERRY_', 'GIT_ASKPASS'];
const SNAP_SUFFIX = '_VSCODE_SNAP_ORIG';
const SNAP_MARKER = /\/snap\/code(\/|$)/;

export function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (k.endsWith(SNAP_SUFFIX)) continue;
    if (DROP_EXACT.has(k)) continue;
    if (DROP_PREFIXES.some((p) => k.startsWith(p))) continue;
    if (k === 'XDG_DATA_DIRS' || k === 'XDG_CONFIG_DIRS' || k === 'PATH') {
      const kept = v.split(':').filter((p) => p && !SNAP_MARKER.test(p));
      if (kept.length) out[k] = kept.join(':');
      continue;
    }
    if (SNAP_MARKER.test(v)) continue; // GTK_PATH, GIO_MODULE_DIR, LOCPATH, GSETTINGS_SCHEMA_DIR, XDG_DATA_HOME, ...
    out[k] = v;
  }
  if (!out.LANG && !out.LC_ALL) out.LANG = 'C.UTF-8';
  out.PATH = withStandardDirs(out.PATH ?? '', out.HOME ?? env.HOME);
  return out;
}

/** Guarantee the directories where ghostty, tmux, xdotool and code usually live are on PATH. */
export function withStandardDirs(path: string, home: string | undefined): string {
  const parts = path.split(':').filter(Boolean);
  const std = [...(home ? [`${home}/.local/bin`] : []), '/usr/local/bin', '/usr/bin', '/bin', '/snap/bin'];
  for (const d of std) if (!parts.includes(d)) parts.push(d);
  return parts.join(':');
}
