# zellij, kitty, other multiplexers, and quake/dropdown on GNOME

Sources: zellij.dev docs and CHANGELOG (0.45.1 latest, 0.44.0 minimum), zellij sources (`route.rs`, `lib.rs`, `cli.rs`), kitty docs (remote-control, launch, sessions, panel), kitty `rc/*.py`, `tabs.py`, `definition.py` (0.48.2), GNOME extension sources, Ghostty #3459/#4624, dev.to "kitty sessions" (2020).

## zellij as backend — rejected

- `zellij --session <current> action switch-session <target>` (0.44.0) sends `SwitchSession` to the "last active client" (the last client that sent a key); no `--client-id`; the client is removed and re-attaches (`create: true`). Fine with one client that has typed; fragile otherwise.
- Tabs from outside: `zellij --session <ws> action new-tab --name X --cwd Y [-- cmd]`, `go-to-tab-name`, `rename-tab`, `close-tab`, `list-tabs --json`, `dump-layout`.
- Per-session env only via a layout file carrying `env { }` (unverified) or `ZELLIJ_SESSION_NAME`.
- Built-in resurrection since 0.39 (`~/.cache/zellij/.../session_info/<ws>/session-layout.kdl`, command panes come back suspended).
- No event stream without a Rust/WASM plugin (`TabUpdate`, `SessionUpdate`, `run_command` to notify).
- Open Linux copy/paste bug with Ghostty 1.3.1 (#4898).
Verdict: worse than tmux behind a daemon (client targeting, detach+reattach switch, plugin for events).

## shpool, abduco, dtach, wezterm mux — rejected

Persistence only, no tabs, no client switching (shpool: "only provides persistent sessions"; abduco/dtach single process). wezterm-mux-server has no third-party client protocol.

## kitty (0.48.2 via official installer; apt 0.21 is unusable) — viable future presenter

- Enable: `-o allow_remote_control=socket-only --listen-on unix:/run/user/<uid>/vscode-tmux-kitty.sock`, client `kitten @ --to unix:... <cmd>`.
- `launch --type=tab --tab-title X --cwd DIR --env K=V --var ws=<id> --var role=<name> [--location=last] -- tmux ...` prints the window id.
- `focus-tab --match 'var:ws=^<id>$ and var:role=^shell$'` (no reorder), `close-tab`, `set-tab-title`, `ls` (JSON; tab order = array order, active = `is_active`), `action goto_tab N`, `detach-tab`.
- `tab_bar_filter` (0.43.0): "Only tabs that match this expression will be shown in the tab bar. The currently active tab is always shown" and `goto_tab`/`next_tab`/`move_tab` respect it. Change at runtime with `kitten @ load-config --override 'tab_bar_filter=var:ws=^<id>$'` (immediate redraw unverified). Switch order: focus-tab first, then filter.
- Sessions (0.43+: `goto_session`, `save_as_session`, `session:` match) are launch-time layouts; nothing keeps processes alive ("with the exception of remote persistence"). The dev.to article is a launch-time layout per project with `startup_session`.
- On Wayland the daemon can switch tabs but cannot raise the OS window (glfw requests its own activation token; Mutter denies). GNOME quirks: CSD, `hide_window_decorations`.
- Defaults: `ctrl+shift+t` new tab, `ctrl+shift+left/right` prev/next; map `alt+N` to `goto_tab N`.

## Quake/dropdown

- Compositor feature. Ghostty quick terminal and kitty's panel/quick-access kitten need wlr-layer-shell: unsupported on GNOME Mutter ("GNOME refuses to implement the requisite Wayland protocol", #3459); supported on KWin (KDE), Hyprland, sway, niri, river.
- GNOME 42 Wayland options: quake-mode extension v9 (supports 41–44, any app, unmaintained), Quake Terminal (45+), ddterm (own VTE terminal). Only a Shell extension can raise/hide a window through Mutter's focus-stealing prevention.
- Design consequence: the tmux-in-one-surface presenter works unchanged inside a quick terminal, so the dropdown becomes a container choice, not a code change.
