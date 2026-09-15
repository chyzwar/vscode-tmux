import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';

/**
 * Runtime socket path. `VSCODE_TMUX_SOCKET` (which the daemon exports into every tmux
 * session, and which tests set for isolation) wins; otherwise the path is computed from
 * the uid rather than XDG_RUNTIME_DIR because the VS Code snap's extension host can see
 * a different runtime dir than the shell.
 */
export function socketPath(): string {
  return process.env.VSCODE_TMUX_SOCKET || join(`/run/user/${userInfo().uid}`, 'vscode-tmux.sock');
}

export function stateDir(): string {
  return join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state'), 'vscode-tmux');
}

export function configDir(): string {
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'vscode-tmux');
}

export const TMUX_SOCKET_NAME = 'vscode-tmux';
export const GHOSTTY_CLASS = 'dev.vscodetmux.Ghostty';
export const LOBBY_SESSION = 'lobby';
