import type { Exec } from '../exec.js';
import type { Log } from '../log.js';
import { KWinRaiser, kwinAvailable } from './kwin.js';
import type { WindowRaiser } from './types.js';
import { XdotoolRaiser } from './xdotool.js';

export type { WindowRaiser } from './types.js';

export interface SelectRaiserOptions {
  exec: Exec;
  log: Log;
  /** Absolute path for the generated KWin script (state dir). */
  kwinScriptPath: string;
}

/**
 * Pick the raiser for this desktop: KWin scripting whenever KWin runs (Plasma on Wayland or X11),
 * else xdotool for other X11 sessions, else nothing (GNOME Wayland: only a Shell extension could
 * raise a window; files still open via `code --goto`, which flashes the taskbar entry).
 */
export async function selectRaiser(o: SelectRaiserOptions): Promise<WindowRaiser | undefined> {
  if (await kwinAvailable(o.exec)) {
    o.log('window raiser: KWin scripting via busctl');
    return new KWinRaiser({ exec: o.exec, scriptPath: o.kwinScriptPath, log: o.log });
  }
  if ((await o.exec('xdotool', ['version'])).code === 0) {
    o.log('window raiser: xdotool (X11/XWayland windows only; a native Wayland VS Code is invisible to it)');
    return new XdotoolRaiser({ exec: o.exec, log: o.log });
  }
  o.log('window raiser: none (no KWin on the session bus, no xdotool); opened files will not raise their window');
  return undefined;
}
