# VS Code Tmux

One Ghostty window that always shows the terminals of the VS Code window you are working in.

- Focus VS Code window A: Ghostty shows A's terminals as tabs `[ Claude ] [ Server ] [ Shell ]`.
- Focus window B: Ghostty switches to `[ Claude ] [ Tests ]`. Nothing is restarted; every process keeps running.
- Close a VS Code window: its Claude Code agents, dev servers and shells keep running in tmux. Reopen the project and it reattaches.
- In any terminal: `vscode src/App.tsx:42:8` opens that file at that position in the VS Code window the terminal belongs to, and raises it.

## How it works

```
VS Code window A --ext--+                             +-- tmux server (-L vscode-tmux)
VS Code window B --ext--+   unix socket (NDJSON)      |     session project-a-<id>: [Claude][Server][Shell]
                        +------- daemon --------------+     session project-b-<id>: [Claude][Tests]
`vscode file:12` CLI ---+          |                  |     session lobby
                                   | launches         +-- one client = the Ghostty surface
                                   +-- ghostty --class=dev.vscodetmux.Ghostty (single surface, tmux draws the tabs)
```

- **Workspace identity** is VS Code's own workspace id (md5 of folder path + inode), read from the extension's storage path. It survives restarts and is unique per window.
- **Session backend** is a dedicated tmux server: one session per workspace, one window per terminal tab, per-session environment (`VSCODE_TMUX_WORKSPACE_ID`, `VSCODE_TMUX_WORKSPACE`, `VSCODE_TMUX_SOCKET`).
- **Presentation** is Ghostty as a single-surface container running one tmux client. A focus change is one `tmux switch-client`. The tab bar is tmux's status line (click to select, `alt+1..9`, `alt+t` new tab, `alt+r` rename, `alt+w` close).
- **Daemon** (Node 26, TypeScript) is auto-started by the extension (via a transient systemd user unit when available) and owns the registry, the tmux server, the Ghostty process and file-open routing.

Why not native Ghostty sessions or native tabs: they do not exist / cannot be driven externally yet. See `docs/adr/0001-session-backend-and-presentation.md` and `docs/research/`. The backend and presenter are interfaces so kitty native tabs, or Ghostty sessions once they land upstream, can be added later.

## Install

Requirements: Ubuntu/Debian-like Linux, Ghostty 1.2+, Node >= 26, VS Code.

```bash
git clone <this repo> ~/MyProjects/vscode-tmux
cd ~/MyProjects/vscode-tmux
./install.bash            # apt tmux xdotool, VS Code .deb, yarn build, CLI symlinks, configs, extension
```

Options: `--no-apt`, `--no-vscode-deb`, `--force-config`. Then reload your VS Code windows.

Manual equivalent: `yarn install && yarn build`, symlink `packages/daemon/dist/cli.mjs` to `~/.local/bin/vscode-tmux` and `packages/daemon/bin/vscode` to `~/.local/bin/vscode`, copy `config/*.conf` to `~/.config/vscode-tmux/`, `code --install-extension packages/extension/vscode-tmux.vsix`.

## Use

- Commands: `VS Code Tmux: Create Terminal`, `VS Code Tmux: Show Session`.
- CLI: `vscode <path[:line[:col]]>` (alias of `vscode-tmux open`), `vscode-tmux new [name] [-- cmd...]`, `vscode-tmux list`, `vscode-tmux status`.
- Logs: `~/.local/state/vscode-tmux/daemon.log`; state snapshot `~/.local/state/vscode-tmux/state.json`; VS Code output channel "VS Code Tmux".
- Direct tmux access: `tmux -L vscode-tmux ls`.

## Limitations (current slice)

- Processes do not survive an OS reboot (tmux cannot do that). Restoring sessions, tab names, cwds and optionally commands from the snapshot is the next milestone.
- Raising the VS Code window uses `xdotool` because VS Code runs under XWayland; without xdotool the `code --goto` fallback may only flash the taskbar entry under GNOME's focus-stealing prevention.
- Ghostty prompt features (jump to prompt, notify on command finish) do not pass through tmux.
- Quick terminal / quake dropdown needs a compositor with layer-shell (KDE, Hyprland, sway); on GNOME it needs a Shell extension.

## Development

```bash
yarn test          # vitest (unit + a real-tmux integration test if tmux is installed)
yarn typecheck
yarn build
node packages/daemon/dist/cli.mjs daemon --foreground
```

Layout: `packages/protocol` (messages, NDJSON codec, env scrubbing), `packages/daemon` (backend, presenter, opener, server, CLI), `packages/extension` (VS Code extension), `config/` (tmux and Ghostty instance configs), `docs/` (ADR, research, plans).
