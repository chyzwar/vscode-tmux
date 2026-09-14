# ADR-0001: Session backend and presentation layer

- Status: accepted (2026-09-14)
- Deciders: project owner, with research summarized in `docs/research/`
- Target environment at decision time: Ubuntu 22.04, GNOME Shell 42.9 on Wayland, Ghostty 1.3.1 (GTK, snap), VS Code 1.132 (snap, XWayland), Node 22

## Context

VS Code Tmux needs (1) terminal processes that outlive VS Code windows, (2) a single terminal window that switches to the focused VS Code workspace's terminals, (3) terminals shown as tabs, and (4) a way for a terminal to open a file in the VS Code window it belongs to.

The preferred design was to use Ghostty's native session management if it existed. It does not. Research (see `docs/research/2026-09-14-ghostty-sessions.md`) established:

- Ghostty 1.3.1, master, and every open PR lack detach/reattach, headless surfaces, named sessions, or a server/client split. Discussion #3358 was a community suggestion locked as noise; "Session Management: Redux" (#12571) received one collaborator reply saying sessions and scripting are "less of a priority". The reconnectable server is being built outside the Ghostty repo (Superlogical, on libghostty). Master only contains building blocks: a binary snapshot codec whose format "will change", stable surface IDs, and a tmux control-mode parser with no GUI wiring.
- `window-save-state` is macOS only. GTK save/restore is deferred to GTK 4.24's session API.
- Ghostty's GTK D-Bus surface (`docs/research/2026-09-14-ghostty-gtk-control.md`) exposes `new-window`, `new-window-command`, and per-window `new-tab`/`close-tab`/splits. It cannot select a tab, retitle a tab, list surfaces, or run arbitrary keybind actions. A daemon therefore cannot drive Ghostty's native tabs.
- Ghostty's quick terminal needs wlr-layer-shell, which GNOME Mutter does not implement (KWin does).

Multiplexer options (`docs/research/2026-09-14-tmux.md`, `docs/research/2026-09-14-zellij-kitty-quake.md`):

- tmux 3.2a (Ubuntu 22.04 apt) provides `switch-client -c <tty> -t '=<session>'` (instant, in place, per-session current window preserved), per-session environment via `new-session -e`, control mode as an event stream, and full isolation with `-L <name> -f <conf>`.
- zellij 0.44+ can switch sessions from the CLI but cannot target a specific client (it acts on the last client that typed), performs the switch as detach plus reattach, and needs a WASM plugin for events.
- shpool, abduco, dtach have no tabs and no client switching.
- kitty 0.48 offers fully scriptable native tabs (`launch --type=tab --var`, `focus-tab`, `tab_bar_filter`) but no process persistence.

## Decision

1. **Session backend: tmux**, running as a dedicated server (`tmux -L vscode-tmux -f <our config>`) so the user's own tmux setup is untouched. One tmux session per VS Code workspace, one tmux window per terminal tab. The tmux server is kept alive with `exit-empty off`.
2. **Presentation: Ghostty as a single-surface container, tmux renders the tab bar.** The daemon launches one Ghostty instance with its own `--class` and config file, running one tmux client. A workspace switch is a single `switch-client`. Tabs are tmux windows drawn as a clickable tab bar in the status line, with `alt+1..9` bound in tmux and unbound in the Ghostty instance config.
3. **Backend and presenter are interfaces.** `SessionBackend` (process lifecycle) and `Presenter` (what the user sees) are separate modules with narrow interfaces so the pairs can change independently. Agreed roadmap: now tmux + Ghostty; later kitty + kitty sessions (native tabs via `tab_bar_filter`); later Ghostty + native Ghostty sessions once they exist upstream.
4. **A small local daemon** (Node/TypeScript, NDJSON over a Unix socket) owns the registry of VS Code windows, the tmux server, the Ghostty process, open-file routing, and the state snapshot. It is auto-spawned by the VS Code extension when its socket is missing.

## Consequences

- Terminals survive VS Code closing and reopen attached to the same tmux session. They do not survive an OS reboot; a snapshot-and-rebuild mechanism is a later milestone.
- Ghostty prompt-aware features (jump to prompt, command-finished notifications, close confirmation) do not work through tmux. tmux's own prompt tracking will be used where needed.
- The tab bar is drawn by tmux, not Ghostty. Drag reordering is not available; ordering is by tmux window index.
- Because everything runs inside one terminal surface, the same design works unchanged inside Ghostty's quick terminal on compositors that support layer-shell (KDE), inside kitty, or inside any other terminal.
- Raising a VS Code window from the daemon relies on VS Code being an X11 (XWayland) client and on `xdotool`; a `code --goto` fallback exists.

## Revisit triggers

- Ghostty exposes list/focus/retitle surface IPC (maintainer stated support for a D-Bus IPC in discussion #2353).
- Ghostty ships native sessions with detach/reattach.
- kitty presenter is implemented and preferred by users.
