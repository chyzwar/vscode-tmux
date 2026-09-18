import type { Exec } from './exec.js';

/**
 * Toggling the dropdown from outside Ghostty.
 *
 * Ghostty 1.3 exposes no IPC for `toggle_quick_terminal` (its D-Bus action map is
 * new-window/new-window-command/open-config/present-surface/quit/reload-config),
 * so the only handle we have is the global shortcut itself. On Plasma the
 * GlobalShortcuts portal registers it with kglobalaccel, which *can* be invoked
 * over D-Bus — that is what `vscode-tmux toggle` uses, and it doubles as the
 * diagnostic for "is the ctrl+` binding actually registered?".
 */

const KGA = 'org.kde.kglobalaccel';
const ROOT = '/kglobalaccel';
const ROOT_IFACE = 'org.kde.KGlobalAccel';
const COMPONENT_IFACE = 'org.kde.kglobalaccel.Component';
/** Ghostty asks the portal for one shortcut per `global:` keybind, named after its trigger. */
const BACKQUOTE = /grave|backquote|`/i;

export interface QuakeShortcut {
  /** D-Bus object path, e.g. /component/ghostty_ghostty. */
  component: string;
  /** Action id, which is the trigger Ghostty asked the portal for, e.g. CTRL+grave. */
  action: string;
}

/** kglobalaccel names a component after the application id, with `.`/`-` folded to `_`. */
export function componentPathFor(appClass: string): string {
  return `/component/${appClass.replace(/[.-]/g, '_')}`;
}

/** busctl prints `as 2 "a" "b"`; pull the quoted strings back out. */
export function parseStringArray(out: string): string[] {
  return [...out.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\(.)/g, '$1'));
}

const shortcutNames = async (exec: Exec, component: string): Promise<string[]> => {
  const r = await exec('busctl', ['--user', 'call', KGA, component, COMPONENT_IFACE, 'shortcutNames']);
  return r.code === 0 ? parseStringArray(r.stdout) : [];
};

/**
 * Find the registered global shortcut of the companion Ghostty.
 *
 * Which component it lands in depends on how xdg-desktop-portal identified the
 * process: our application id when Ghostty is a host binary started from the
 * `app-<app id>.service` unit, but `ghostty_ghostty` for the snap, which the
 * portal attributes to the snap instead. So: look where we expect it, then fall
 * back to whichever component owns a backquote trigger.
 */
export async function findQuakeShortcut(exec: Exec, appClass: string): Promise<QuakeShortcut | undefined> {
  const own = componentPathFor(appClass);
  const mine = await shortcutNames(exec, own);
  const action = mine.find((n) => BACKQUOTE.test(n)) ?? mine[0];
  if (action) return { component: own, action };

  const all = await exec('busctl', ['--user', 'call', KGA, ROOT, ROOT_IFACE, 'allComponents']);
  if (all.code !== 0) return undefined;
  const components = parseStringArray(all.stdout).filter((c) => c.startsWith('/component/'));
  // Ghostty first: another application may well own a backquote shortcut too.
  for (const component of components.sort((a, b) => Number(b.includes('ghostty')) - Number(a.includes('ghostty')))) {
    if (!/ghostty|vscodetmux/i.test(component)) continue;
    const found = (await shortcutNames(exec, component)).find((n) => BACKQUOTE.test(n));
    if (found) return { component, action: found };
  }
  return undefined;
}

/** Press the global shortcut on the user's behalf. Undefined when nothing is registered. */
export async function toggleQuake(exec: Exec, appClass: string): Promise<QuakeShortcut | undefined> {
  const found = await findQuakeShortcut(exec, appClass);
  if (!found) return undefined;
  const r = await exec('busctl', ['--user', 'call', KGA, found.component, COMPONENT_IFACE, 'invokeShortcut', 's', found.action]);
  if (r.code !== 0) throw new Error(`invokeShortcut ${found.action} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
  return found;
}
