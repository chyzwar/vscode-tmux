# End-to-end checklist (vertical slice)

Prerequisites: `./install.bash` ran (it installs the compiled daemon binary at `~/.local/bin/vscode-tmux`), VS Code windows reloaded, `vscode-tmux status` prints a socket and `"runtime": "bun ..."`.

| # | Step | Expected |
|---|------|----------|
| 1 | Open two folders in two VS Code windows (A, B). | `vscode-tmux list` shows both, each with a `Shell` tab. A Ghostty window titled "VS Code Tmux" appears showing the focused workspace. `tmux -L vscode-tmux ls` lists `lobby`, `<a>-<id>`, `<b>-<id>`. |
| 2 | In A run `VS Code Tmux: Create Terminal` twice (names `Claude`, `Server`). | Ghostty's tab bar shows `1 Shell  2 Claude  3 Server`, Server selected. `alt+2` selects Claude; clicking a tab selects it. |
| 3 | Click B's window, then A's window. | Ghostty switches to B's tabs within ~100 ms, then back to A with the previously selected tab still selected. |
| 4 | In an A tab start `sleep 1000`; switch to B and back. | `sleep` still running (`vscode-tmux list` shows `(sleep)`). |
| 5 | In an A tab: `vscode README.md:3:2`, while B is the active VS Code window. | README.md opens at 3:2 in window A and window A is raised. `vscode .` raises A. From a B tab the same opens in B. |
| 6 | Close window A. | `tmux -L vscode-tmux ls` still lists A's session; `sleep` still alive. |
| 7 | Reopen folder A. | Extension output says "reattached"; Ghostty shows the same tabs; no new session. |
| 8 | Close the Ghostty window; click a VS Code window. | Ghostty is relaunched by the daemon and shows that workspace. |
| 9 | `yarn test` | all green. |

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
