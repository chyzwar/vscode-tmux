import { readFileSync, writeFileSync } from 'node:fs';
import type { Exec } from './exec.js';
import type { Log } from './log.js';
import { toggleQuake } from './quake.js';

/**
 * Resizing the dropdown from outside Ghostty.
 *
 * Ghostty 1.3 reads `quick-terminal-size` once, when a quick-terminal window
 * maps for the first time: `reload_config` leaves an existing window at its old
 * size (GTK keeps a toplevel's allocation across hide/show and only honours the
 * default size on the first map), and `toggle_fullscreen` is a no-op because the
 * dropdown is a layer-shell surface, not an xdg toplevel. The one working route
 * is: rewrite the size in the deployed config, `reload-config`, `close` the
 * window, and press ctrl+` so a fresh window maps at the new size. The tmux
 * client in the dropdown dies with the window; the server and its sessions do
 * not, and the `client-attached` hook puts the next client on the right session.
 *
 * Both actions are on the GApplication action map the companion exports over
 * D-Bus. It runs without gtk-single-instance and so owns no well-known name;
 * the connection is found by the unit's main PID.
 */

const ACTIONS_IFACE = 'org.gtk.Actions';
/** How long to wait for the closed window to leave the object tree. */
const CLOSE_POLLS = 40;
const CLOSE_POLL_MS = 50;

/** GApplication exports its action map at the application id with `.` as path separator. */
export const appObjectPath = (appClass: string): string => `/${appClass.replace(/\./g, '/')}`;

/** `busctl list --no-legend` prints `NAME PID PROCESS ...`; the unique name (`:1.42`) of the connection pid owns. */
export function parseBusName(list: string, pid: number): string | undefined {
  for (const line of list.split('\n')) {
    const [name, owner] = line.trim().split(/\s+/);
    if (name?.startsWith(':') && Number(owner) === pid) return name;
  }
  return undefined;
}

/** `busctl tree` draws object paths with box characters; keep the window objects under the app path. */
export function parseWindowPaths(tree: string, appPath: string): string[] {
  const prefix = `${appPath}/window/`;
  return tree
    .split('\n')
    .map((l) => l.replace(/^[\s│├└─]+/, '').trim())
    .filter((l) => l.startsWith(prefix) && /^\d+$/.test(l.slice(prefix.length)));
}

/** Ghostty accepts `NN%` or `NNpx`, optionally `,` and a second one for the other axis. */
export const isQuickTerminalSize = (v: unknown): v is string => typeof v === 'string' && /^\d+(px|%)(,\d+(px|%))?$/.test(v);

const SIZE_LINE = /^[ \t]*quick-terminal-size[ \t]*=[ \t]*(.*?)[ \t]*$/m;

export const currentQuickTerminalSize = (config: string): string | undefined => config.match(SIZE_LINE)?.[1];

/** Replace the `quick-terminal-size` line, or append one. Nothing else in the file is touched. */
export function withQuickTerminalSize(config: string, size: string): string {
  const line = `quick-terminal-size = ${size}`;
  if (SIZE_LINE.test(config)) return config.replace(SIZE_LINE, line);
  return config + (config.endsWith('\n') || config === '' ? '' : '\n') + line + '\n';
}

export async function companionBusName(exec: Exec, unit: string): Promise<string | undefined> {
  const pid = Number((await exec('systemctl', ['--user', 'show', '-p', 'MainPID', '--value', unit])).stdout.trim());
  if (!pid) return undefined;
  const r = await exec('busctl', ['--user', 'list', '--no-legend']);
  return r.code === 0 ? parseBusName(r.stdout, pid) : undefined;
}

/** `org.gtk.Actions.Activate(name, [], {})` on an exported action map. */
export async function activateAction(exec: Exec, dest: string, path: string, action: string): Promise<void> {
  const r = await exec('busctl', ['--user', 'call', dest, path, ACTIONS_IFACE, 'Activate', 'sava{sv}', action, '0', '0']);
  if (r.code !== 0) throw new Error(`${action} on ${path} failed (${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
}

export async function windowPaths(exec: Exec, dest: string, appClass: string): Promise<string[]> {
  const r = await exec('busctl', ['--user', 'tree', dest]);
  return r.code === 0 ? parseWindowPaths(r.stdout, appObjectPath(appClass)) : [];
}

export interface DropdownHeightOptions {
  exec: Exec;
  /** systemd user unit of the companion; its main PID identifies the bus connection. */
  unit: string;
  appClass: string;
  /** The deployed ghostty.conf, the one the companion was started with. */
  configPath: string;
  full: string;
  short: string;
  readFile?: (path: string) => string;
  writeFile?: (path: string, text: string) => void;
  sleep?: (ms: number) => Promise<void>;
  log?: Log;
}

export type DropdownHeightState =
  /** Config written; the companion is not running, so it applies when the unit starts. */
  | 'not-running'
  /** Config reloaded; no window was open, so the next ctrl+` already uses the new size. */
  | 'no-window'
  /** Window closed and reopened at the new size. */
  | 'rebuilt'
  /** Window closed, but no global shortcut is registered to reopen it (not Plasma). */
  | 'closed';

export interface DropdownHeightResult {
  size: string;
  state: DropdownHeightState;
}

/** Flip the dropdown between `full` and `short`: anything other than `full` becomes `full`. */
export async function toggleDropdownHeight(o: DropdownHeightOptions): Promise<DropdownHeightResult> {
  const read = o.readFile ?? ((p) => readFileSync(p, 'utf8'));
  const write = o.writeFile ?? ((p, t) => writeFileSync(p, t));
  const sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = o.log ?? (() => {});

  const config = read(o.configPath);
  const size = currentQuickTerminalSize(config) === o.full ? o.short : o.full;
  write(o.configPath, withQuickTerminalSize(config, size));

  const dest = await companionBusName(o.exec, o.unit);
  if (!dest) {
    log(`dropdown: wrote ${size}; ${o.unit} is not on the bus`);
    return { size, state: 'not-running' };
  }
  const appPath = appObjectPath(o.appClass);
  await activateAction(o.exec, dest, appPath, 'reload-config');

  const windows = await windowPaths(o.exec, dest, o.appClass);
  if (!windows.length) return { size, state: 'no-window' };
  for (const w of windows) await activateAction(o.exec, dest, w, 'close');
  for (let i = 0; i < CLOSE_POLLS && (await windowPaths(o.exec, dest, o.appClass)).length; i++) await sleep(CLOSE_POLL_MS);

  const pressed = await toggleQuake(o.exec, o.appClass);
  log(`dropdown: ${size}, window rebuilt via ${pressed?.action ?? 'nothing (no shortcut)'}`);
  return { size, state: pressed ? 'rebuilt' : 'closed' };
}
