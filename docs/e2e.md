# End-to-end checklist (vertical slice)

Prerequisites: `./install.bash` ran (it installs the compiled daemon binary at `~/.local/bin/vscode-tmux`), VS Code windows reloaded, `vscode-tmux status` prints a socket and `"runtime": "bun ..."`.

| # | Step | Expected |
|---|------|----------|
| 1 | Open two folders in two VS Code windows (A, B), then press ctrl+`. | `vscode-tmux list` shows both, each with a `Shell` tab. The Ghostty dropdown slides down showing the focused workspace. `tmux -L vscode-tmux ls` lists `lobby`, `<a>-<id>`, `<b>-<id>`. |
| 2 | In A run `VS Code Tmux: Create Terminal` twice (names `Claude`, `Server`). | Ghostty's tab bar shows `1 Shell  2 Claude  3 Server`, Server selected. `alt+2` selects Claude; clicking a tab selects it. |
| 3 | Click B's window, then A's window. | Ghostty switches to B's tabs within ~100 ms, then back to A with the previously selected tab still selected. |
| 4 | In an A tab start `sleep 1000`; switch to B and back. | `sleep` still running (`vscode-tmux list` shows `(sleep)`). |
| 5 | In an A tab: `vscode README.md:3:2`, while B is the active VS Code window. | README.md opens at 3:2 in window A and window A is raised. `vscode .` raises A. From a B tab the same opens in B. |
| 5b | In an A tab run `bun run typecheck` (or anything printing `file:line`), then ctrl+click or alt+click a path. | The file opens at that line in window A, A is raised, the dropdown hides. Ctrl+clicking a word that is not a file does nothing. |
| 6 | Close window A. | `tmux -L vscode-tmux ls` still lists A's session; `sleep` still alive. |
| 7 | Reopen folder A. | Extension output says "reattached"; Ghostty shows the same tabs; no new session. |
| 8 | `systemctl --user stop app-dev.vscodetmux.Ghostty.service`, then focus a VS Code window and press ctrl+`. | The daemon starts the unit again and the dropdown shows that workspace. |
| 9 | `bun run test` | all green. |

Automated smoke test without VS Code (used during development): `scratchpad/fake-ext.mjs` speaks the protocol; see `packages/daemon/test/server.test.ts` for the message flow.

## Results 2026-09-14 (GNOME 42 Wayland, Ghostty 1.3.1 snap, tmux 3.2a, VS Code 1.132 snap, Node 26)

Verified in this session:
- Daemon + protocol-level fake extension: hello creates sessions with env; focus A → B → A switches the Ghostty tmux client in place and A's selected tab is preserved; `createTerminal` adds tabs.
- Installed extension in four real VS Code windows: all registered and reattached after a daemon restart; the extension respawned the daemon within 2 s when it was killed.
- `vscode README.md:3` via the CLI from a terminal of the email-automation workspace opened the file in that window and raised it (`xdotool getactivewindow` confirmed) while another window was active.
- `vscode docs/e2e.md:9:4` typed into a real tab of the vscode-tmux workspace (real extension) opened the file in that window and raised it while email-automation was active (daemon.log: `raised=true`).
- Ghostty launched by the daemon (systemd user unit) attaches and shows the requested session.

Found and fixed along the way:
- tmux replaces tab separators with `_` in a C locale: formats now use a printable separator.
- Dropping `XDG_DATA_DIRS`/`GDK_*` wholesale broke GTK; scrubbing now only removes values that point into the code snap.
- Several windows spawning the daemon at once crashed the losers on a socket unlink race; `listen()` retries and yields to the winner.
- `xdotool windowactivate` (`_NET_ACTIVE_WINDOW`) is ignored by Mutter for XWayland windows most of the time; `windowraise` + `windowfocus --sync` is honored. The opener now does activate, raise, focus and verifies with `getactivewindow`; the exact-title search is retried because VS Code renames the window a moment after the editor opens.
- Ghostty started by a background process never creates its surface when native Wayland on GNOME 42 (window object and D-Bus name exist, no child process; reproducible with `env -i $(systemctl --user show-environment) setsid -f ghostty --class=x --gtk-single-instance=true --command=<script>`); under `GDK_BACKEND=x11` it works every time. Default is now X11, configurable.

Pending user verification after reloading VS Code windows: steps 2, 3, 6, 7, 8 interactively.

## Results 2026-09-17 (GNOME 42 Wayland, VS Code 1.137 .deb)

- VS Code 1.137 (.deb, Electron 42.10) runs as a native Wayland client (`--ozone-platform=wayland` in its child processes); `xdotool search --name 'Visual Studio Code'` finds nothing, and `_NET_CLIENT_LIST` only lists the XWayland Ghostty. The xdotool raise path is therefore dead on every Wayland desktop; the daemon now picks a raiser per desktop (`packages/daemon/src/raise/`): KWin scripting on Plasma, xdotool in X11 sessions, none otherwise.
- The new code paths were unit-tested with fake `busctl`/extension replies and by executing the generated KWin script against a fake `workspace`; no KWin was available to test against.

## Kubuntu 26.04 (Plasma 6.6, Wayland) — to verify on the new machine

| # | Step | Expected |
|---|------|----------|
| 1 | `./install.bash` | apt installs `ghostty` from the archive (1.3.0); the script prints "window raising: KWin scripting over D-Bus". |
| 2 | Focus a VS Code window. | Ghostty appears as a native Wayland window (no `GDK_BACKEND` in `daemon.log`'s settings line means `auto`; KWin's window info shows app id `dev.vscodetmux.Ghostty`, server-side decorations). |
| 3 | From a tab of A while B is active: `vscode README.md:3`. | `daemon.log`: `window raiser: KWin scripting via busctl`, then `raised=true`; A is in front. `~/.local/state/vscode-tmux/kwin-raise.js` holds the last script. |
| 4 | Same with A minimized / on another virtual desktop. | KWin unminimizes / switches desktop. |
| 5 | `busctl --user status org.kde.KWin` and `busctl --user --json=short call org.kde.KWin /Scripting org.kde.kwin.Scripting isScriptLoaded s vscode-tmux-raise` after an open. | KWin owns the name; the script is unloaded again (`false`). |
| 6 | Ghostty quick terminal (optional): set `quick-terminal-*` keys in `~/.config/vscode-tmux/ghostty.conf`. | Works on KWin (layer-shell), unlike GNOME. |

## Results 2026-09-18 (Kubuntu 26.04, Plasma 6.6.6 Wayland, Ghostty 1.3.1 snap, tmux 3.6, VS Code 1.138 .deb)

Quake dropdown, verified on the machine (not only in tests):
- `app-dev.vscodetmux.Ghostty.service` starts with `Type=notify` (Ghostty sends `READY=1`), stays `active` with no window, and survives its tmux session being killed.
- The portal registered the global keybind: kglobalaccel action `CTRL+grave` → `toggle_quick_terminal`, keys `0x4000060`. Invoking it creates the quick terminal, which attaches an `xterm-ghostty` tmux client.
- With a workspace parked by the daemon (protocol-level `hello`), reopening the dropdown attaches straight to that workspace's session; a live focus change switches the attached client.
- `vscode-tmux click` on `README.md:3:1`, on `file://…/package.json#L5` (OSC 8) and on the word `the`: opened + raised, opened at line 5, and did nothing, respectively.
- `bun run test` 127 green, on the Bun runtime (no Node installed for the toolchain).

Notes found on the way:
- Ghostty 1.3's `link` option is not settable ("TODO: This can't currently be set!"), and `+validate-config --link=…` exits 1: custom click patterns must live in tmux, not Ghostty.
- `client-attached` does **not** fire when the attaching `new-session -A` creates the session; `session-created` covers that path. Both hooks are set, guarded with `if -F` so the switch does not re-trigger.
- With the Ghostty **snap**, xdg-desktop-portal attributes the shortcut to the snap (`ghostty_ghostty`), not to `dev.vscodetmux.Ghostty`; the app-id/unit-name/desktop-entry trio only applies to a host (deb) install.
- tmux's default `word-separators` splits on `/`, `.` and `:`, so `#{mouse_word}` returned fragments; the companion server now sets `word-separators ' '`.
