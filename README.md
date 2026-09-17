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
- **Presentation** is Ghostty as a single-surface container running one tmux client. A focus change is one `tmux switch-client`. The tab bar is tmux's status line (click to select, `alt+1..9`, `ctrl+wheel` or wheel over the bar to cycle, `ctrl+t`/`alt+t` new tab, `alt+r` rename, `alt+w` close).
- **Daemon** (TypeScript, shipped as one Bun-compiled Linux x64 binary at `~/.local/bin/vscode-tmux`) is auto-started by the extension (via a transient systemd user unit when available) and owns the registry, the tmux server, the Ghostty process and file-open routing. See `docs/adr/0002-compiled-bun-daemon.md`.
- **Raising a VS Code window** (`vscode file:12` from a terminal) goes through the compositor: on Plasma the daemon loads a small KWin script over D-Bus (`busctl`, no extra tool) that activates the window by title, then confirms through the extension that the window took focus. VS Code is a native Wayland window since Electron 38.2, so X11 tools cannot see it; `xdotool` is only used in X11 sessions. See `docs/adr/0003-raise-via-kwin-scripting.md`.

Why not native Ghostty sessions or native tabs: they do not exist / cannot be driven externally yet. See `docs/adr/0001-session-backend-and-presentation.md` and `docs/research/`. The backend and presenter are interfaces so kitty native tabs, or Ghostty sessions once they land upstream, can be added later.

## Install

Requirements: Ubuntu/Debian-like Linux (x64), Ghostty 1.2+, VS Code, Bun >= 1.3 (installed by `install.bash` if missing; package manager and daemon compiler), Node >= 26 (esbuild, tsc, vitest and vsce run on Node). Target desktop: Kubuntu 26.04 (Plasma 6.6, Wayland only); it also runs on Ubuntu 22.04 GNOME 42 Wayland, where windows cannot be raised (see Limitations).

```bash
git clone <this repo> ~/MyProjects/vscode-tmux
cd ~/MyProjects/vscode-tmux
./install.bash            # apt tmux (+ghostty on 26.04), VS Code .deb, bun install + build, daemon binary, configs, extension
```

Options: `--no-apt`, `--no-vscode-deb`, `--force-config`. Then reload your VS Code windows.

Manual equivalent: `bun install && bun run build`, copy `packages/daemon/dist/vscode-tmux` to `~/.local/bin/vscode-tmux`, symlink `packages/daemon/bin/vscode` to `~/.local/bin/vscode`, copy `config/*.conf` to `~/.config/vscode-tmux/`, `code --install-extension packages/extension/vscode-tmux.vsix`. The extension only spawns the binary; the .vsix does not contain it. Put it elsewhere with the `vscode-tmux.daemonPath` VS Code setting.

## Use

- Commands: `VS Code Tmux: Create Terminal`, `VS Code Tmux: Show Session`.
- CLI: `vscode <path[:line[:col]]>` (alias of `vscode-tmux open`), `vscode-tmux new [name] [-- cmd...]`, `vscode-tmux list`, `vscode-tmux status`.
- Settings: `~/.config/vscode-tmux/config.json` (`ghosttyGdkBackend`: `auto` (default: XWayland on GNOME, native Wayland elsewhere) | `x11` | `wayland` | `default`, `ghosttyStartTimeoutMs`). VS Code setting `vscode-tmux.daemonPath` overrides the daemon binary location.
- Plasma: the companion window's app id is `dev.vscodetmux.Ghostty`, so a KWin window rule (System Settings > Window Management > Window Rules) can pin it to a screen, keep it on all desktops or drop its title bar.
- Logs: `~/.local/state/vscode-tmux/daemon.log`, `ghostty.log`; state snapshot `~/.local/state/vscode-tmux/state.json`; VS Code output channel "VS Code Tmux".
- Direct tmux access: `tmux -L vscode-tmux ls`.

## Limitations (current slice)

- Processes do not survive an OS reboot (tmux cannot do that). Restoring sessions, tab names, cwds and optionally commands from the snapshot is the next milestone.
- Raising the VS Code window works on Plasma (KWin scripting sees native Wayland and XWayland windows and is not subject to focus-stealing prevention) and in X11 sessions (`xdotool`). On GNOME Wayland VS Code 1.137 is a native Wayland window that no external tool can raise (only a Shell extension could); files still open and the `code --goto` fallback flashes the taskbar entry.
- Ghostty prompt features (jump to prompt, notify on command finish) do not pass through tmux.
- Quick terminal / quake dropdown needs a compositor with layer-shell (KDE, Hyprland, sway); on GNOME it needs a Shell extension.
- The companion Ghostty runs natively on Wayland except on GNOME, where it runs under XWayland (`GDK_BACKEND=x11`): on GNOME 42 Wayland a Ghostty started by a background process never created its terminal surface when running natively (reproducible with `env -i <systemd user env> setsid -f ghostty --class=... --command=...`). Override with `ghosttyGdkBackend` in `~/.config/vscode-tmux/config.json`.

## Development

```bash
bun run test       # vitest on Node (unit, a real-tmux integration test, and a smoke test of the compiled binary if built); not `bun test`
bun run typecheck
bun run build      # extension via esbuild; daemon via `bun build --compile` -> packages/daemon/dist/vscode-tmux
(cd packages/daemon && bun run dev)         # daemon in the foreground from source
./packages/daemon/dist/vscode-tmux daemon --foreground
```

The daemon source uses only `node:` APIs so tests run on Node while the shipped binary runs on Bun. `VSCODE_TMUX_SOCKET` overrides the socket path (tests use it for isolation).

Layout: `packages/protocol` (messages, NDJSON codec, env scrubbing), `packages/daemon` (backend, presenter, opener, `raise/` window raisers, server, CLI), `packages/extension` (VS Code extension), `config/` (tmux and Ghostty instance configs), `docs/` (ADR, research, plans).
