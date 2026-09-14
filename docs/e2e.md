# End-to-end checklist (vertical slice)

Prerequisites: `./install.bash` ran, VS Code windows reloaded, `vscode-tmux status` prints a socket.

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

Results 2026-09-14 (GNOME 42 Wayland, Ghostty 1.3.1 snap, tmux 3.2a, VS Code 1.132 snap): steps 1-5 verified with the daemon plus a protocol-level fake extension and a real VS Code window (xdotool raise confirmed via `xdotool getactivewindow`); steps 1-8 with the installed extension pending user verification.
