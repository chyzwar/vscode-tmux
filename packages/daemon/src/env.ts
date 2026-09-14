/**
 * Environment hygiene. The daemon may be spawned from VS Code's extension host
 * (a snap with GTK/GIO paths pointing into the snap) or from inside a tmux
 * pane. Anything that would confuse tmux, Ghostty, or the shells started in
 * sessions is removed before we spawn them.
 */
const DROP_PREFIXES = ['VSCODE_', 'ELECTRON_', 'TERM_PROGRAM', 'TMUX', 'GHOSTTY_', 'SNAP', 'CHROME_', 'GIO_', 'GTK_', 'GDK_', 'LOCPATH', 'GSETTINGS_', 'LD_LIBRARY_PATH', 'NODE_OPTIONS', 'npm_', 'YARN_', 'COREPACK_', 'BAMF_', 'XDG_DATA_DIRS', 'GST_', 'PYTHONPATH', 'FONTCONFIG_', 'GI_TYPELIB_PATH', 'LIBGL_DRIVERS_PATH', 'QT_', 'INIT_CWD', 'PROJECT_CWD', 'BERRY_', 'VSCODE_GIT'];

export function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue;
    if (k.endsWith('_VSCODE_SNAP_ORIG')) continue;
    if (DROP_PREFIXES.some((p) => k.startsWith(p))) continue;
    out[k] = v;
  }
  // Restore values the snap wrapper saved before overriding them.
  for (const [k, v] of Object.entries(env)) {
    if (k.endsWith('_VSCODE_SNAP_ORIG') && v) {
      const orig = k.slice(0, -'_VSCODE_SNAP_ORIG'.length);
      if (orig === 'XDG_DATA_DIRS' || orig === 'GTK_PATH' || orig === 'GIO_MODULE_DIR' || orig === 'LOCPATH' || orig === 'GSETTINGS_SCHEMA_DIR' || orig === 'GDK_BACKEND') {
        if (orig === 'XDG_DATA_DIRS') out[orig] = v;
      }
    }
  }
  if (!out.XDG_DATA_DIRS) out.XDG_DATA_DIRS = '/usr/local/share:/usr/share:/var/lib/snapd/desktop';
  if (!out.LANG) out.LANG = 'C.UTF-8';
  return out;
}
