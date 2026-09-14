# Ghostty native session management — state as of 2026-09-14

Sources: github.com/ghostty-org/ghostty discussions, issues, PRs, `main` source tree, ghostty.org release notes, mitchellh's posts. Stable at research time: 1.3.1 (2026-03-13). 1.4.0 unreleased (milestone open, "mid/late September" per #13766).

## Verdict

Native detach/reattach, persistent/headless sessions, named sessions, and a server/client split are **not implemented** in Ghostty: not in 1.3.1, not on master, not in any open PR. No flag, no experimental mode, no macOS-only variant.

| Capability | 1.3.1 GTK | 1.3.1 macOS | master / 1.4.0 | Open PR |
|---|---|---|---|---|
| Detach/reattach a running session | No | No | No | No |
| Headless sessions surviving window close | No | No | No | No |
| Named sessions / list / switch | No ("Session Search" = jump to a live surface) | same | same | No |
| Server/client split | No | No | Only libghostty-vt snapshot codec | No |
| Window/tab/split restore across restart | No (`window-save-state` "has no effect on Linux") | Yes (layout, cwd, titles; no scrollback) | unchanged | closed |
| Programmatic switching of terminals | No | AppleScript `focus`/`select tab` (preview) | GTK: `+new-tab --surface-id=N` (create only) | closed |

## Timeline

- 2023-10 #2353 "Scripting API for Ghostty": mitchellh 2025-07-25: "100% on board with exposing an IPC API that is Linux-specific with D-bus". Wants narrow per-action PRs (`list_surfaces`, `focus_surface` named).
- 2024-12-27 #3358 "Suggestion: Session manager" — opened by `pbvrl` (not a maintainer; mitchellh never commented). Locked 2025-03-19 by jcollie: "collection of 'me too' posts".
- 2025-08 #8252 "BOO! Ids" (mitchellh): 64-bit surface IDs "for a Ghostty API and session attach/detach"; closed: "bigger fish to fry".
- 2025-11 #9451 GSettings window-state persistence for GTK — closed; mitchellh: "leaning on the GTK sessions API will be a better approach".
- 2025-12 #9860 tmux control mode core loop merged (1.3.0) — "viewer only, for now", no GUI.
- 2025-12-17 mitchellh on X: "The goal is a tmux replacement based on libghostty, embed that in Ghostty GUI ... and for Ghostty GUI (and others) to be able to connect to it" (quoted from search snippets; X returned 403).
- 2026-03 #11549 / 2026-04 #12055: GTK save/restore waits for GTK 4.24's native session management API (jcollie: "core GTK developers have a consensus").
- 2026-03-30 #11998 binary terminal snapshots: mitchellh 2026-08-06: "This is done ... Snapshot v1 is fully supported in Zig and C, although we'll continue to modify the format".
- 2026-04-08 #12176 "Reconnectable Terminal using libghostty": mitchellh 2026-08-06 (accepted answer): "We're doing this ourselves using the binary snapshot protocol."
- 2026-05-03 #12571 "Session Management: Redux" (theherk, not a maintainer). Only maintainer-side reply, rhodes-b: "right now sessions / more scripting capabilities is less of a priority". 1 upvote, no label, no implementation.
- 2026-06-08 #12962 Linux session and scrollback restore (fhackenberger) — auto-closed by the vouch bot; lives on in the henricook fork.
- 2026-07-29 mitchellh.com/writing/superlogical: new company; first product is a server-side multiplexer with durable sessions on libghostty; pre-beta. "Ghostty itself remains a non-profit; its ... roadmap do not change."
- 2026-07-31 → 08-19 binary snapshot series merged to 1.4.0 (#13534 et al.): "The format can and will change ... Version 1 has no compatibility promise."
- 2026-08-09 #11762 `+new-tab` merged (1.4.0).

## Source tree on main

- No files named session/server/daemon/persist/detach/resurrect.
- `src/apprt/ipc.zig`: actions are exactly `new_window`, `new_tab`, `toggle_quick_terminal`.
- `src/terminal/snapshot/`: "NOT a full transport-ready format to implement generic replay software such as multiplexers".
- `src/terminal/tmux/`: parser + viewer state machine only; no config key, no GUI wiring.
- README roadmap: session management is not an item.

## What exists today that partially helps

- GTK: `quit-after-last-window-closed = false` keeps the process resident; D-Bus/systemd activation; `ghostty +new-window`; "Session Search" in the command palette. Closing a window still kills its PTYs.
- macOS: `window-save-state = always`; AppleScript can enumerate and focus terminals.
- Third-party on libghostty-vt: zmx, herdr (named sessions, detach), prise (archived 2026-08-11), cmux.

## Consequence for this project

A multiplexer is required for process persistence. See ADR-0001.
