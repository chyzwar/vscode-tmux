/**
 * Runtime socket path. Computed from the uid rather than XDG_RUNTIME_DIR because
 * the VS Code snap's extension host can see a different runtime dir than the shell.
 */
export declare function socketPath(): string;
export declare function stateDir(): string;
export declare function configDir(): string;
export declare const TMUX_SOCKET_NAME = "vscode-tmux";
export declare const GHOSTTY_CLASS = "dev.vscodetmux.Ghostty";
export declare const LOBBY_SESSION = "lobby";
