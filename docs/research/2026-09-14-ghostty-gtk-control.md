# Ghostty 1.3.1 (GTK) external control — what a daemon can and cannot do

Sources: Ghostty source at tag v1.3.1 and main (`src/apprt/gtk/class/application.zig`, `window.zig`, `tab.zig`, `src/cli/new_window.zig`, `src/apprt/gtk/ipc/DBus.zig`, `src/input/Binding.zig`, `src/config/Config.zig`), GTK 4.14 `gtkapplication-dbus.c`, GLib `gapplicationimpl-dbus.c`, Mutter `meta-wayland-activation.c`, ghostty.org docs. Local checks: `ghostty +list-actions`, `ghostty +show-config --default --docs`, strings in the snap binary.

## D-Bus surface

Bus name = `class` config (default `com.mitchellh.ghostty`), object path `/com/mitchellh/ghostty`. The name is owned **only in single-instance mode**; `gtk-single-instance=detect` turns single instance off when `TERM_PROGRAM` is set or any CLI argument is present, so pass `--gtk-single-instance=true` explicitly.

Application-level `org.gtk.Actions` (v1.3.1): `new-window` (no arg), `new-window-command` (`as`: `--command=`, `--working-directory=`, `--title=`, `-e argv...`), `open-config`, `present-surface` (`t` = **raw pointer** in 1.3.1; unusable and unsafe from outside), `quit`, `reload-config`. Master adds `new-tab (tas)`, `toggle-quick-terminal`, `ring-bell`, and `present-surface` by surface ID (`GHOSTTY_SURFACE_ID` env in 1.4).

Window-level actions are also exported (GTK exports every `GtkApplicationWindow` at `<path>/window/<N>`): `close`, `close-tab (s: this|other|right)`, `new-tab`, `new-window`, `prompt-*-title` (dialogs), `ring-bell`, `split-*`, `copy`, `paste`, `reset`, `clear`, `toggle-command-palette`, `toggle-inspector`. `new-tab` runs in that window's active surface with no per-call command/cwd/title. Tab-level actions are not exported.

Other interfaces: standard `org.freedesktop.Application` (`Activate` = new window) and `org.gtk.Application`. No custom Ghostty interface. D-Bus activation (`dist/linux/dbus.service.in`) starts `ghostty --gtk-single-instance=true --initial-window=false`.

## CLI

Only `+new-window` talks to a running instance in 1.3.1 (`--class`, `--working-directory`, `--command`, `--title`, `-e`). Equivalent: `gdbus call --session --dest com.mitchellh.ghostty --object-path /com/mitchellh/ghostty --method org.gtk.Actions.Activate new-window-command '[<@as ["-e","echo","hello"]>]' []`. Master adds `+new-tab --surface-id=N`, `+toggle-quick-terminal`.

## Keybind actions from outside

None. `goto_tab`, `next_tab`, `previous_tab`, `set_tab_title`, `set_surface_title`, `toggle_quick_terminal` cannot be triggered externally on 1.3.1 or master. `performable` is only a binding flag.

## Config keys that matter

- `class`: WM_CLASS / Wayland app-id / D-Bus name; valid GApplication id required (e.g. `dev.vscodetmux.Ghostty`).
- `gtk-single-instance`: `true|false|detect`.
- `window-save-state`: macOS only.
- `-e` forces `gtk-single-instance=false`; use `--command=` (config key `command`) or `+new-window -e` instead.
- `title`: forces the window title and drops OSC title changes for all surfaces.
- `env = K=V`: extra env for spawned commands (instance-wide).
- `window-show-tab-bar = never|auto|always` (GTK); `gtk-tabs-location`; `confirm-close-surface`.
- Quick terminal: needs wlr-layer-shell → **not available on GNOME Mutter** (`winproto/wayland.zig supportsQuickTerminal`; discussion #3459, issue #4624). Works on KWin/wlroots.

## Titles

OSC 0/2 and OSC 7 are honored. Tab title precedence: tab override > surface override > terminal title > config `title`. The only external pin is `+new-window --title` at creation.

## Focus/raise on GNOME Wayland

`window.present()` requests an xdg-activation token with the app's own last serial; Mutter honors it only if the token's surface has keyboard focus, otherwise marks "demands attention" ("Ghostty is ready" toast). A headless daemon cannot mint a valid token. `org.gnome.Shell.Introspect.GetWindows` is allow-listed to portal backends; `Eval` needs unsafe mode. Only a GNOME Shell extension (`Main.activateWindow`) raises reliably. `win.ring-bell` flashes.

## Capability matrix for a daemon (1.3.1, GNOME Wayland)

| Goal | Possible | How |
|---|---|---|
| Open window with cwd/command/title | Yes | `new-window-command` / `+new-window` |
| Open tab in a specific window | Yes, undocumented | `/window/N` `new-tab`; no command/cwd/title |
| Select a tab | No | |
| Query active tab / list surfaces | No | |
| Set tab title after creation | No | |
| Raise a window | Not reliably | Mutter FSP |
| Close tab / split / copy / paste / clear | Yes | `/window/N` actions |
| Quick terminal | No on GNOME | layer-shell |

Conclusion: Ghostty native tabs cannot be driven by a daemon today; use Ghostty as a single-surface container.
