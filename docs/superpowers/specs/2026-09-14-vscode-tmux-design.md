# VS Code Tmux — research conclusions, architecture, and vertical-slice plan

## Context

Goal: one Ghostty window that always shows the terminal session of whichever VS Code window is focused, with terminals as tabs, processes that outlive VS Code, and `vscode file:line` from a terminal opening in the *right* VS Code window.

Environment (verified locally): Ubuntu 22.04.5, GNOME Shell 42.9 on Wayland, Ghostty 1.3.1 (snap, classic, GTK/libadwaita), VS Code 1.132.0 (snap, forced `--ozone-platform=x11`, so an XWayland client), Node 22.12, pnpm, no tmux, no xdotool. apt candidates: tmux 3.2a, xdotool 3.2016.

### Research verdicts (2026-09-14, primary sources; full write-ups go into `docs/research/`)

- **Ghostty native session management: does not exist.** Not in 1.3.1, not on master, not in any open PR. #3358 was a community suggestion (locked as "me too"), #12571 "Session Management: Redux" got one collaborator reply ("less of a priority"). mitchellh is building the reconnectable server in a separate product (Superlogical) on libghostty. Master (→1.4) only has binary terminal snapshots (format "will change"), stable surface IDs, `+new-tab`, and a tmux control-mode parser with no GUI. `window-save-state` is macOS-only; GTK restore is deferred to GTK 4.24.
- **Ghostty GTK external control is too thin for native tabs.** D-Bus (`org.gtk.Actions`) exposes `new-window`, `new-window-command`, and per-window `new-tab`/`close-tab`/splits. No tab select, no retitle, no state query, no way to invoke keybind actions. `present-surface` takes a raw pointer in 1.3.1. Quick terminal requires wlr-layer-shell → unavailable on Mutter, available on KWin.
- **tmux 3.2a suffices**: `switch-client -c <tty> -t '=<session>'` is an in-place instant switch that preserves each session's current window; `new-session -e K=V` gives per-session env; control mode streams `%client-session-changed`, `%session-window-changed`, `%window-*`; `-L vscode-tmux -f our.conf` isolates our server and skips the user's tmux.conf. `exit-empty off` keeps the server alive. No reboot persistence → the daemon snapshots and rebuilds (custom JSON, not resurrect).
- **zellij rejected as backend**: `switch-session` cannot target a client (uses "last client that typed"), the switch is detach+reattach, events need a WASM plugin, open copy/paste bug with Ghostty 1.3.1. shpool/abduco/dtach: no tabs, no client switching.
- **kitty (0.48, official installer only)** can do externally driven native tabs (`launch --type=tab --var ws=…`, `focus-tab`, `tab_bar_filter` via `load-config --override`) but does not persist processes. Kept as a *future presenter*, not the MVP.
- **VS Code**: `window.onDidChangeWindowState.focused` is per-window OS focus (first event is authoritative, initial sync value is a placeholder `true`). Workspace identity = VS Code's own storage hash: `md5(folder.fsPath + inode)` on Linux (verified against `~/.config/Code/User/workspaceStorage`), `md5(path)` for `.code-workspace`; readable from `context.storageUri`. `code <exact-folder> --goto file:line:col` routes to that folder's window. Extension host is Node (Unix sockets fine). Raising a window: Electron's own focus request may be downgraded to "is ready" by Mutter; `xdotool windowactivate` on the X11 window (timestamp 0 passes Mutter's check) works. All VS Code windows share one PID, so match by title.
- **Quake/dropdown**: compositor feature. On GNOME 42 Wayland only a Shell extension can do it (quake-mode v9 supports 41–44; Quake Terminal needs 45+). User plans KDE, where Ghostty's own quick terminal works and our tmux-in-one-surface design fits it unchanged. Listed as a post-MVP feature.

### Decision (ADR-0001, to be written in repo)

- **Session backend: tmux** (dedicated server `-L vscode-tmux`, own config). Ghostty native sessions do not exist; revisit when Ghostty exposes list/focus surface IPC (mitchellh: "100% on board" with D-Bus IPC, #2353).
- **Presentation: Ghostty as a single-surface container; tmux status line renders the tabs.** One Ghostty instance (own `--class`, own config file) running one tmux client. Workspace switch = one `switch-client`. Tabs = tmux windows, clickable (`mouse on`), alt+1..9 bound in tmux (unbound in our Ghostty config).
- **Presenter and backend are interfaces** (`Presenter { ensureVisible(), show(sessionName) }`, `SessionBackend { ensureSession, listTabs, newTab, ... }`) so future pairs can be added without touching the extension or broker. Agreed roadmap of backends: **now** tmux + Ghostty; **later** kitty + kitty sessions (native tabs via `tab_bar_filter`, kitty session files for layout), and Ghostty + native Ghostty sessions once they land upstream.
- **Daemon: yes, small.** Node/TypeScript, NDJSON over a Unix socket, auto-spawned by the extension. Owns: registry of live VS Code windows, tmux server/sessions, Ghostty process, open-file routing, state snapshot.

## Architecture

```
VS Code window A ──ext──┐                         ┌─ tmux server (-L vscode-tmux)
VS Code window B ──ext──┤  unix socket (NDJSON)   │    session project-a-<hash8>: [Claude][Server][Shell]
                        ├──────── daemon ─────────┤    session project-b-<hash8>: [Claude][Tests]
`vscode file:12` CLI ───┘        │                │    session lobby (placeholder)
                                 │ spawn/launch   └─ one client = Ghostty surface (switch-client -c <tty>)
                                 └─ ghostty --class=dev.vscodetmux.Ghostty --gtk-single-instance=true
                                              --config-file=~/.config/vscode-tmux/ghostty.conf
                                              --command="tmux -L vscode-tmux -f <tmux.conf> new-session -A -s lobby"
```

Five separated concerns, one package each or one module each:
1. workspace/context detection → `packages/extension`
2. process lifecycle → `packages/daemon/src/backend/tmux.ts` (behind `SessionBackend`)
3. Ghostty presentation → `packages/daemon/src/presenter/ghostty.ts` (behind `Presenter`)
4. IPC/broker → `packages/protocol` + `packages/daemon/src/server.ts`
5. persistence/restore → `packages/daemon/src/state.ts` (JSON snapshot; restore-on-boot is post-slice)

### Persistent IDs

- `workspaceId`: VS Code storage hash (32 hex). Extension: `basename(dirname(context.storageUri.fsPath))`. Daemon can recompute from a path (`md5(fsPath + String(stat.ino))`, or `md5(path)` for `.code-workspace`) — used by CLI fallbacks and restore. Empty windows (no folder) are ignored.
- tmux session name: `<slug>-<workspaceId[0:8]>`, slug = folder basename with `[^A-Za-z0-9_-]` → `-` (tmux rewrites `:` and `.`). Always target with `=` prefix (exact match).
- Tab identity within a running server: tmux window id `@N`; the snapshot stores `{name, cwd, command?}` in order and re-creates on restore.
- Session env (set with `new-session -e`, inherited by every later window): `VSCODE_TMUX_WORKSPACE_ID`, `VSCODE_TMUX_WORKSPACE` (folder path), `VSCODE_TMUX_SOCKET`.

### IPC protocol (NDJSON, `\n`-delimited JSON objects; `id` for request/response pairing)

Socket: `/run/user/<uid>/vscode-tmux.sock` (computed from uid, not from `XDG_RUNTIME_DIR`, because the snap ext host may see a different runtime dir). State: `~/.local/state/vscode-tmux/state.json`. Logs: `~/.local/state/vscode-tmux/daemon.log`.

Extension → daemon:
- `hello {workspaceId, folder, workspaceFile?, name, extHostPid, vscodePid, focused}` → `helloResult {sessionName, created}`
- `focus {workspaceId, focused: boolean}` (only `focused: true` triggers a switch; `false` is recorded)
- `createTerminal {workspaceId, name?, cwd?, command?}` → `result`
- `showSession {workspaceId}` → `result` (ensures Ghostty visible + switch)
Daemon → extension:
- `open {id, path, line?, col?}` → extension replies `result {id, ok, data: {title}}` (was `openResult` until the zod protocol schemas; `result` is the only reply type now) where `title` is the predicted OS window title (`${dirty}${activeEditorShort} - ${rootName} - Visual Studio Code`, computed from the `window.title` template after the editor is shown)
CLI → daemon:
- `open {workspaceId?, cwd, target}` → `result {ok, via: 'extension'|'code-cli'}`
- `list` / `status` → `result {...}`

### Focus → switch flow
1. Extension gets `onDidChangeWindowState` with `focused: true` → sends `focus`.
2. Daemon: `ensureSession(ws)` (idempotent), `presenter.show(sessionName)`:
   - find Ghostty's tmux client: `list-clients -F '#{client_tty} #{client_termname} #{client_control_mode}'`, pick the non-control client with termname `xterm-ghostty` (fallback: any non-control client);
   - none → launch Ghostty (detached, scrubbed env) and poll `list-clients` up to ~3 s;
   - `switch-client -E -c <tty> -t '=<session>'`.
3. Debounce 50 ms; ignore if already showing that session. Rapid A→B→A is naturally handled since tmux keeps each session's current window.

### Open-file flow
1. `vscode src/App.tsx:42[:8]` (CLI) parses `path[:line[:col]]`, resolves against cwd, reads `VSCODE_TMUX_WORKSPACE_ID` from env, sends `open` to the daemon. `vscode .` → open/focus the workspace folder window.
2. Daemon looks up the live extension connection for that workspaceId:
   - connected → forward `open`; extension does `workspace.openTextDocument` + `showTextDocument({selection})` + `revealRange(InCenter)`, replies with predicted title; daemon raises the window: `xdotool search --name "^<title>$"` → `xdotool windowactivate --sync`. If xdotool is absent, run `code "<folder>" --goto "<file>:<line>:<col>"` as the raise attempt.
   - not connected (window closed) → `code "<folder>" --goto "<file>:<line>:<col>"` (reopens the workspace window; extension then reconnects and reattaches the existing tmux session).
   - no workspaceId in env → `code --goto` (last active window), exit code 0 with a warning on stderr.

### Ghostty config (`~/.config/vscode-tmux/ghostty.conf`, loaded on top of the user's config)
```
title = VS Code Tmux
confirm-close-surface = false
window-show-tab-bar = never
keybind = alt+1=unbind … alt+9=unbind      # let tmux handle tab hotkeys
keybind = ctrl+shift+t=unbind              # new tab goes through the daemon/tmux
```
(`gtk-single-instance=true` and `class` are passed on the CLI so the instance is separate from the user's normal Ghostty.)

### tmux config (`config/tmux.conf`, copied to `~/.config/vscode-tmux/tmux.conf`)
Key settings (see tmux research for the full sketch): `exit-empty off`, `destroy-unattached off`, `detach-on-destroy off`, `mouse on`, `status-position top`, `status-left ''`, `status-right ''`, `window-status-format`/`window-status-current-format` as tab pills, `window-status-separator ''`, `automatic-rename off`, `allow-rename off`, `set-titles on` (`#S — #W`), `default-terminal tmux-256color`, `terminal-features 'xterm-ghostty:RGB,...'`, `extended-keys on`, `set-clipboard on`, `focus-events on`, `escape-time 10`, `bind -n M-1..9 select-window -t :N`, `bind -n C-S-t`? (no: send new-tab through `vscode-tmux new` for now), `history-limit 50000`. Note tmux 3.2a lacks `allow-passthrough` (3.3) and OSC 8 (3.4); harmless for the slice.

### Daemon lifecycle
- Extension `activate()`: try connect; on ENOENT/ECONNREFUSED spawn daemon then retry with backoff (200 ms × 10). Spawn preference: `systemd-run --user --collect --unit=vscode-tmux-<uid> <node> <cli.js> daemon` (clean env, survives VS Code exit); fallback `child_process.spawn(..., {detached: true, stdio: 'ignore'})` with env scrubbed of `VSCODE_*`, `ELECTRON_*`, `TERM_PROGRAM*`, `TMUX*`, `GHOSTTY_*`, `GTK_PATH`, `GIO_MODULE_DIR`, `LD_LIBRARY_PATH`, `SNAP*`, `LOCPATH`, `GSETTINGS_SCHEMA_DIR`. `node` resolved via `$SHELL -lc 'command -v node'`, fallback `process.execPath` + `ELECTRON_RUN_AS_NODE=1`.
- Daemon is single-instance (socket bind + lock file), idles forever, `exit-empty off` on tmux so sessions outlive everything. Daemon restart is harmless: it reconciles from `list-sessions`/`list-windows` plus `state.json`.

## Repository layout

```
package.json                 pnpm workspace, root scripts (build, test, lint)
pnpm-workspace.yaml
tsconfig.base.json
packages/protocol/           message types + NDJSON codec (shared)
packages/daemon/             `vscode-tmux` CLI + daemon (one esbuild bundle: dist/cli.js)
  src/main.ts                subcommands: daemon | open | list | status | new
  src/server.ts              socket server, dispatch, connection registry
  src/registry.ts            workspaceId → {folder, name, sessionName, conn?}
  src/backend/types.ts       SessionBackend interface
  src/backend/tmux.ts        TmuxBackend (argv builders are pure + an injectable exec)
  src/presenter/types.ts     Presenter interface
  src/presenter/ghostty.ts   GhosttyPresenter (launch, find client tty, switch)
  src/opener.ts              open routing + xdotool/code fallbacks
  src/ids.ts                 workspaceId + session naming
  src/state.ts               state.json read/write
  src/target.ts              `path[:line[:col]]` parsing
  bin/vscode                 shim → `vscode-tmux open "$@"`
packages/extension/          VS Code extension (esbuild bundle)
  src/extension.ts           identity, connect/spawn, focus events, open handler, 2 commands
  package.json               commands: "VS Code Tmux: Create Terminal", "VS Code Tmux: Show Session"
config/tmux.conf, config/ghostty.conf
docs/adr/0001-session-backend-and-presentation.md
docs/research/2026-09-14-{ghostty-sessions,ghostty-gtk-control,vscode-apis,tmux,zellij-kitty-quake}.md
scripts/install-local.sh     pnpm build, symlink ~/.local/bin/{vscode,vscode-tmux}, copy configs, `code --install-extension` of the packaged .vsix
```

Stack: TypeScript strict, Node 22 built-ins only in the daemon (`node:net`, `node:child_process`, `node:crypto`, `node:fs`), esbuild for bundles, vitest for tests, `@vscode/vsce` for packaging.

## Implementation steps (vertical slice)

1. **Docs first**: write ADR-0001 and the five research notes (from the reports gathered in this session), plus `README.md` with the architecture diagram and prerequisites (`sudo apt install tmux xdotool`).
2. **Scaffold** workspace, three packages, tsconfig, esbuild scripts, vitest.
3. **protocol**: message union types + `encode`/`decode` NDJSON stream parser. Tests: framing, partial chunks, invalid JSON.
4. **daemon core (TDD)**: `ids.ts` (hash matches VS Code's; test with a temp dir + `stat.ino`), `target.ts` (`a.ts`, `a.ts:10`, `a.ts:10:5`, `.`, absolute/relative, Windows-ish colons rejected), `backend/tmux.ts` argv builders (`ensureServer`, `ensureSession(name, cwd, env)`, `newWindow`, `listClients` parsing, `switchClient`), `presenter/ghostty.ts` client selection logic, `opener.ts` title-based raise + fallbacks (exec injected, tested with fakes), `server.ts` dispatch.
5. **daemon main**: socket server, spawn tmux server with our config, `lobby` session, single-instance lock, logging.
6. **CLI**: `vscode-tmux daemon|open|list|status|new`, `bin/vscode` shim.
7. **extension**: identity from `storageUri`, connect/spawn, `hello`, `focus` on `onDidChangeWindowState`, `open` handler with predicted title, commands `createTerminal`/`showSession`. Bundle daemon `cli.js` into the extension so the spawn path is self-contained.
8. **install script** + manual e2e checklist (`docs/e2e.md`).

## Verification (end to end, manual, on this machine)

Prereq: `sudo apt install -y tmux xdotool` (user runs it). Then `pnpm i && pnpm build && scripts/install-local.sh`, reload VS Code windows.

1. Open `~/projects/project-a` and `~/projects/project-b` (any two folders) in two VS Code windows. Expect: daemon started (`vscode-tmux status`), tmux sessions `project-a-…` and `project-b-…` exist with one `Shell` window each, Ghostty window titled "VS Code Tmux" appears showing the focused workspace's session.
2. Run `VS Code Tmux: Create Terminal` twice in A (names `Claude`, `Server`); tab bar in Ghostty shows `[Claude][Server][Shell]`-style pills; alt+2 selects Server.
3. Click B's VS Code window → Ghostty shows B's tabs within ~100 ms; click A → A's tabs with the previously selected tab still selected. Start `sleep 1000` in a tab, switch away and back: still running.
4. In A's shell: `vscode src/index.ts:42:8` → file opens at 42:8 in window A and window A is raised even though B was active. `vscode .` focuses A. From a tab of B, the same opens in B.
5. Close window A. `tmux -L vscode-tmux ls` still lists A's session and `sleep` is alive. Reopen the folder → extension reattaches (no new session, existing tabs shown).
6. `pnpm test` green; `vscode-tmux list` prints workspaces/sessions/tabs.

## Explicitly out of the slice (next milestones, in order)
- Restore after reboot: systemd user unit for the daemon, snapshot on tmux control-mode events, recreate sessions/tabs/cwd/optionally commands on boot (`remain-on-exit`/`respawn-window` for "Restart Terminal Command").
- Commands: Rename/Close Terminal, Restart Terminal Command, Reconnect Session; tab reorder persistence.
- `code` wrapper (opt-in shell function).
- Kitty presenter (native tabs via `tab_bar_filter`).
- Quake/dropdown: on KDE use Ghostty's quick terminal as the container (same single-surface design); on GNOME a Shell extension (quake-mode v9 for 42, Quake Terminal for 45+).
- Raise via a GNOME/KDE extension instead of xdotool when VS Code ever runs native Wayland.
