# 4. Quake dropdown via Ghostty's quick terminal

Date: 2026-09-18
Status: accepted
Verified against: Ghostty 1.3.1 (snap, classic), Plasma 6.6.6 Wayland, xdg-desktop-portal 1.21.1 + xdg-desktop-portal-kde 6.6.6, tmux 3.6, Kubuntu 26.04.

## Context

The companion window was a normal Ghostty window that the daemon opened and kept
around. It should be a quake dropdown instead: invisible until `ctrl+\``, then
sliding down over whatever is on screen.

Ghostty has this built in — the quick terminal, a wlr-layer-shell surface on
Wayland (KWin, Hyprland, sway, niri; Mutter does not implement the protocol) —
and since 1.3 it can be bound to a *global* keybind on GTK through the XDG
GlobalShortcuts portal (KDE 5.27+, GNOME 48+). The dropdown itself is therefore
configuration, not code:

```ini
initial-window = false
quit-after-last-window-closed = false
keybind = global:ctrl+backquote=toggle_quick_terminal
quick-terminal-position = top
```

Three things do not follow from that, and they are what this ADR is about.

1. **Nothing may own the window's lifetime but the user.** The quick terminal is
   created the first time the hotkey is pressed, and the global shortcut belongs
   to the process, not to a window: the process has to be running, windowless,
   before anyone presses anything, and it has to survive closing the dropdown.
2. **The daemon cannot open it.** Ghostty 1.3 exposes no IPC for
   `toggle_quick_terminal`: its GTK action map is `new-window`,
   `new-window-command`, `open-config`, `present-surface`, `quit`,
   `reload-config` (`src/apprt/gtk/class/application.zig`). A `+new-window` IPC
   would give us a *normal* window, which is the thing we are replacing.
3. **The daemon no longer knows when the terminal appears.** `show(session)` used
   to be `tmux switch-client` on a client that was always attached. Now the
   client attaches whenever the user pulls the dropdown down, which may be long
   after the VS Code window was focused — or never.

## Decision

**The companion runs as a systemd user unit, `app-dev.vscodetmux.Ghostty.service`.**
`WantedBy=graphical-session.target` starts it at login, `Restart=on-failure`
keeps it there, and `Type=notify` works because Ghostty sends `READY=1` when its
run loop is up (`src/os/systemd.zig`), so `systemctl start` returns only once the
shortcut is really registered. The daemon starts the unit when it needs the
companion and falls back to spawning Ghostty itself when the unit is not
installed (`presenter/runner.ts`).

The unit name is not cosmetic. For a host process, xdg-desktop-portal derives
the application id from the systemd user unit, matching `app-<app id>.service`
and requiring a matching `<app id>.desktop`
(`src/xdp-app-info-host.c`), which is how KDE files, names and remembers the
shortcut. Hence the unit name and the `NoDisplay` desktop entry, which KWin also
uses for the task manager entry and window rules.

**The session to show is parked in tmux, not held in the daemon.** `show()` sets
two global hooks so that whichever client attaches next lands on the right
session:

```
set-hook -g client-attached "if -F '#{!=:#{client_session},<s>}' 'switch-client -E -t =<s>'"
set-hook -g session-created "…same…"
```

Both are needed: `client-attached` covers attaching to an existing session, and
`session-created` covers the case where the dropdown's `new-session -A -s lobby`
*creates* the session — `client-attached` does not fire on that path (verified in
`test/tmux.integration.test.ts`). The `if` guard stops the hook from acting on
the session it just switched to. A client that is already attached is still
switched directly, so a focus change while the dropdown is down is immediate.

**`vscode-tmux toggle` presses the shortcut through kglobalaccel** (`quake.ts`),
since that is the only external handle on the quick terminal. It is Plasma-only
and mostly a diagnostic: it answers "is ctrl+` actually bound?".

## Consequences

- The dropdown follows VS Code focus even while hidden: focus window B, pull the
  dropdown down, B's tabs are there. No restart, no reattach.
- `quick-terminal-autohide = false` is the default here (it is also Ghostty's
  Linux default): this is a companion terminal you read while typing in the
  editor, not a scratchpad. Flip it for classic quake behaviour.
- The VS Code command *Show Session* and a focus change can no longer raise the
  terminal — nothing outside Ghostty can. They switch what the dropdown shows.
- GNOME gets no dropdown (no layer shell). The fallback there is the old
  behaviour: a normal window, which the spawn runner still produces.
- With the Ghostty **snap**, the portal attributes the shortcut to the snap
  (component `ghostty_ghostty`, "Ghostty" in System Settings) instead of to our
  application id, because a classic snap runs in its own systemd scope. It works;
  it just shares a component with any other Ghostty. `findQuakeShortcut` searches
  for the component instead of assuming it.
- Killing the tmux server no longer kills the terminal: the process stays and the
  next `ctrl+\`` creates a fresh lobby.

## Alternatives rejected

- **A KWin script toggling a normal window** (minimise/restore, keep-above, a
  `registerShortcut` binding). More code, worse result: no layer shell means no
  slide-in, no overlay above fullscreen windows, and focus-stealing rules to
  fight. KWin scripting also does not manage layer surfaces, so it cannot drive
  the real quick terminal either.
- **A Plasma global shortcut on `vscode-tmux toggle`** instead of Ghostty's
  `global:` keybind. It is a strictly longer path to the same kglobalaccel
  action, and it needs the daemon running to press a key.
- **Teaching the attach command to ask the daemon** (`command = vscode-tmux
  attach`) instead of parking the target in tmux. That puts a second process in
  the surface for its whole lifetime (Ghostty watches the process it spawned, so
  the wrapper cannot exec away on Bun/Node) and makes the dropdown useless when
  the daemon is down.
