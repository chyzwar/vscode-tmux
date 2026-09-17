# ADR-0003: Raise VS Code windows through KWin scripting; Ghostty native Wayland outside GNOME

- Status: accepted (2026-09-17)
- Deciders: project owner
- Target environment at decision time: Kubuntu 26.04 LTS (Plasma 6.6, Wayland session only; `plasma-session-x11` is unsupported and not installed), VS Code 1.137 (.deb, Electron 42), Ghostty 1.3 (Ubuntu archive), tmux 3.6a, systemd 259. Development still happens on Ubuntu 22.04 GNOME 42 Wayland.

## Context

ADR-0001 raised the target VS Code window with `xdotool` because VS Code was an XWayland client. Two things changed:

- Electron 38.2+ picks Wayland by itself in a Wayland session, and VS Code 1.137 does: its processes carry `--ozone-platform=wayland` and `xdotool search` finds no VS Code window at all, on GNOME today and on Plasma tomorrow. `code <folder> --goto` still opens the file, but the resulting `win.focus()` has no valid xdg-activation token, so KWin only flashes the panel entry and Mutter shows an "is ready" notification.
- Kubuntu 26.04 has no X11 session, so nothing in the raise path may depend on X11 tools.

On Plasma the compositor exposes `org.kde.kwin.Scripting` on the session bus: a JavaScript file is loaded by path, run inside KWin, and may set `workspace.activeWindow`, which activates any window (native Wayland or XWayland) without focus-stealing checks. `kdotool` wraps exactly this, but it is packaged neither in Debian nor in Ubuntu, and it needs a D-Bus service of its own to return results. `busctl` ships with systemd on every target, and a `--json=short` call returns the script id.

Ghostty ran under XWayland by default because of a GNOME 42 bug (a Ghostty started from a systemd user unit never creates its surface when native). Under KWin native Wayland works and gives fractional scaling, server-side decorations, an app id that KWin window rules can match, and the layer-shell quick terminal.

## Decision

1. `packages/daemon/src/raise/` holds a `WindowRaiser` interface with two implementations, chosen once per daemon in `selectRaiser`: `KWinRaiser` when `busctl --user status org.kde.KWin` succeeds, else `XdotoolRaiser` when `xdotool` exists (X11 sessions), else none. Without a raiser the opener still routes the file to the right window and runs `code --goto`.
2. `KWinRaiser` writes `~/.local/state/vscode-tmux/kwin-raise.js` for each open request (exact predicted title first, otherwise the single window whose title contains ` - <workspace name> - `, non-normal windows skipped), loads it under the plugin name `vscode-tmux-raise`, runs it, and unloads it. Raises are serialized because file and plugin name are shared.
3. The KWin script has no return channel, so verification goes through the extension: the daemon sends `windowStateRequest` and the extension answers with `vscode.window.state.focused`. The raiser polls this a few times per run and re-runs the script up to three times (VS Code renames the window a moment after the editor opens), then reports failure and the opener falls back to `code --goto`.
4. `ghosttyGdkBackend` gains the value `auto`, now the default: `x11` when `XDG_CURRENT_DESKTOP` names GNOME, otherwise `GDK_BACKEND` is left untouched, i.e. native Wayland under KWin.
5. `install.bash` installs `xdotool` only in an X11 session, takes Ghostty from the Ubuntu archive when available, and prints which raiser the daemon will use.

## Consequences

- No new runtime dependency on Plasma; `busctl` and KWin are always there. The generated script and the busctl argv are unit-tested; the script itself is executed in the tests against a fake `workspace` object. Nothing has been exercised against a real KWin yet (see `docs/e2e.md`, Kubuntu section).
- Raising costs three to four D-Bus round trips plus 100 ms polling steps; a successful raise takes about 200 ms.
- On GNOME Wayland raising is not possible any more (VS Code is native Wayland there too); only a Shell extension could do it. Not pursued: the GNOME machine is being replaced.
- Plasma 5 (`/<id>` script object paths, `workspace.clientList`) is not supported; the script falls back to `workspace.stackingOrder` only.

## Revisit triggers

- VS Code gains xdg-activation support for `--goto` (Electron passes `XDG_ACTIVATION_TOKEN` from the CLI): then `code --goto` alone would raise and the raiser becomes redundant.
- KWin's scripting D-Bus API changes (object path or `loadScript` signature).
- Ghostty starts natively on the GNOME machine, at which point `auto` can drop the GNOME special case.
