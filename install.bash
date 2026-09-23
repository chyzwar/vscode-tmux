#!/usr/bin/env bash
# VS Code Tmux — one-shot installer for Ubuntu/Debian (Kubuntu 26.04 Plasma Wayland, Ubuntu 22.04 GNOME).
#
#   ./install.bash [--no-apt] [--no-vscode-deb] [--force-config] [--snap-ghostty]
#
# What it does (idempotent):
#   1. apt: tmux, curl, unzip; xdotool only in an X11 session (a native Wayland VS Code is
#      invisible to it; on Plasma the daemon raises windows through KWin scripting instead)
#   2. VS Code as a .deb from Microsoft (needs sudo; skipped with --no-vscode-deb or if already a deb)
#   3. Ghostty >= 1.3 (the quake dropdown needs global keybinds on GTK): apt when the archive
#      has it (Ubuntu >= 26.04), otherwise the snap; --snap-ghostty forces the snap
#   4. Bun (package manager, daemon compiler, and the runtime for tsc/esbuild/vitest/vsce),
#      `bun install && bun run build`
#   5. CLI: copies the daemon binary to ~/.local/bin/vscode-tmux, symlinks ~/.local/bin/vscode
#   6. Configs: ~/.config/vscode-tmux/{tmux.conf,ghostty.conf} (kept if present unless --force-config)
#   7. The quake dropdown: ~/.local/share/applications/dev.vscodetmux.Ghostty.desktop and the
#      systemd user unit app-dev.vscodetmux.Ghostty.service, enabled so ctrl+` works from login
#   8. Installs the extension .vsix into VS Code
#   9. (Re)starts the daemon as a transient systemd user unit
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NO_APT=0; NO_VSCODE_DEB=0; FORCE_CONFIG=0; SNAP_GHOSTTY=0
for arg in "$@"; do
  case "$arg" in
    --no-apt) NO_APT=1 ;;
    --no-vscode-deb) NO_VSCODE_DEB=1 ;;
    --force-config) FORCE_CONFIG=1 ;;
    --snap-ghostty) SNAP_GHOSTTY=1 ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

session_type="${XDG_SESSION_TYPE:-unknown}"
desktop="${XDG_CURRENT_DESKTOP:-unknown}"
log "desktop: $desktop, session: $session_type ($(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME" || echo unknown))"

# 1. apt packages -----------------------------------------------------------
apt_has_candidate() { apt-cache policy "$1" 2>/dev/null | grep -qE '^\s+Candidate: [0-9]'; }
if [[ $NO_APT -eq 0 ]]; then
  if command -v apt-get >/dev/null; then
    wanted=(tmux curl unzip)
    [[ $session_type == x11 ]] && wanted+=(xdotool)
    if [[ $SNAP_GHOSTTY -eq 0 ]] && ! command -v ghostty >/dev/null && apt_has_candidate ghostty; then wanted+=(ghostty); fi
    missing=()
    for pkg in "${wanted[@]}"; do dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg"); done
    if [[ ${#missing[@]} -gt 0 ]]; then
      log "installing apt packages: ${missing[*]}"
      sudo apt-get update -qq
      sudo apt-get install -y "${missing[@]}"
    else
      log "apt packages present: ${wanted[*]}"
    fi
  else
    warn "apt-get not found; install tmux (and xdotool in an X11 session) yourself"
  fi
fi
command -v tmux >/dev/null || die "tmux is required"
log "tmux $(tmux -V | cut -d' ' -f2)"

# How the daemon will raise VS Code windows on this desktop (see packages/daemon/src/raise/).
if busctl --user status org.kde.KWin >/dev/null 2>&1; then
  log "window raising: KWin scripting over D-Bus (busctl); no extra tool needed"
elif [[ $session_type == x11 ]] && command -v xdotool >/dev/null; then
  log "window raising: xdotool (X11 session)"
else
  warn "window raising: none. VS Code is a native Wayland window here and only the compositor can raise it"
  warn "(KWin: supported; GNOME Wayland: needs a Shell extension). 'vscode file' still opens files; the taskbar entry flashes."
fi

# 2. VS Code as a .deb -------------------------------------------------------
if [[ $NO_VSCODE_DEB -eq 0 ]]; then
  if dpkg -s code >/dev/null 2>&1; then
    log "VS Code .deb already installed ($(dpkg-query -W -f='${Version}' code))"
  else
    log "downloading VS Code .deb (stable, x64)"
    tmp="$(mktemp -d)"
    curl -fsSL -o "$tmp/code.deb" 'https://code.visualstudio.com/sha/download?build=stable&os=linux-deb-x64'
    log "installing VS Code .deb (adds Microsoft's apt repo)"
    sudo apt-get install -y "$tmp/code.deb"
    rm -rf "$tmp"
  fi
  if snap list code >/dev/null 2>&1; then
    warn "the 'code' snap is also installed. Both provide a 'code' command; the .deb one is /usr/bin/code."
    warn "Not removing the snap automatically: ~/snap/code holds data (e.g. Claude Code's install). Remove it yourself with: sudo snap remove code"
  fi
fi

# 3. Ghostty -----------------------------------------------------------------
# apt is preferred: the snap is a classic snap that runs in its own systemd scope,
# so xdg-desktop-portal attributes the ctrl+` shortcut to the snap ("Ghostty" in
# System Settings) rather than to this companion. Both work.
if ! command -v ghostty >/dev/null && command -v snap >/dev/null && [[ $NO_APT -eq 0 || $SNAP_GHOSTTY -eq 1 ]]; then
  log "installing the Ghostty snap (classic)"
  sudo snap install ghostty --classic || warn "snap install ghostty failed"
  hash -r
fi
if command -v ghostty >/dev/null; then
  log "Ghostty: $(ghostty --version 2>/dev/null | head -n 1)"
else
  warn "Ghostty not found. Install it ('sudo snap install ghostty --classic', 'sudo apt install ghostty' on Ubuntu >= 26.04, or the ghostty-ubuntu .deb) and re-run."
fi

# 4. Bun / build -------------------------------------------------------------
export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun >/dev/null; then
  log "installing Bun (runs the whole toolchain; only touches ~/.bun and your shell rc)"
  curl -fsSL https://bun.sh/install | bash
  hash -r
fi
command -v bun >/dev/null || die "bun not found after install; install Bun (https://bun.sh) and re-run"
log "bun $(bun --version)"
cd "$REPO"
log "bun install && bun run build"
bun install --frozen-lockfile
bun run build
bun run --filter vscode-tmux-extension package >/dev/null

# 5. CLI ---------------------------------------------------------------------
# The daemon binary is copied (atomic rename): a running daemon keeps its old inode,
# `vscode file` never execs a half-written file, and later builds never hit ETXTBSY.
mkdir -p "$HOME/.local/bin"
daemon_bin="$HOME/.local/bin/vscode-tmux"
install -m 0755 "$REPO/packages/daemon/dist/vscode-tmux" "$daemon_bin.new"
mv -f "$daemon_bin.new" "$daemon_bin"
chmod +x "$REPO/packages/daemon/bin/vscode"
ln -sfn "$REPO/packages/daemon/bin/vscode" "$HOME/.local/bin/vscode"
log "installed ~/.local/bin/vscode-tmux ($(du -h "$daemon_bin" | cut -f1)) and linked ~/.local/bin/vscode"
case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) warn "~/.local/bin is not on your PATH" ;; esac

# 6. Configs -----------------------------------------------------------------
mkdir -p "$HOME/.config/vscode-tmux"
for f in tmux.conf ghostty.conf; do
  if [[ $FORCE_CONFIG -eq 1 || ! -e "$HOME/.config/vscode-tmux/$f" ]]; then
    cp "$REPO/config/$f" "$HOME/.config/vscode-tmux/$f"
    log "installed ~/.config/vscode-tmux/$f"
  else
    log "kept existing ~/.config/vscode-tmux/$f (use --force-config to overwrite)"
  fi
done
# A running tmux server keeps the config it started with, so re-apply options and
# key bindings (the mouse click-to-open bindings live there) without killing it.
if tmux -L vscode-tmux has-session 2>/dev/null; then
  tmux -L vscode-tmux source-file "$HOME/.config/vscode-tmux/tmux.conf" 2>/dev/null \
    && log "reloaded tmux.conf into the running vscode-tmux server" \
    || warn "could not source tmux.conf into the running server; restart it with: tmux -L vscode-tmux kill-server"
fi

# 7. Quake dropdown: desktop entry + companion Ghostty user unit --------------
# The companion runs windowless in the background and ctrl+` toggles Ghostty's
# quick terminal. Two files have to be exact:
#   - the unit is named app-<app id>.service, which is how xdg-desktop-portal
#     derives the application id of a host (non-flatpak) process;
#   - a matching <app id>.desktop must exist or that lookup falls back to no id,
#     and KDE then cannot attribute (or remember) the global shortcut.
apps_dir="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
units_dir="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
ghostty_unit="app-dev.vscodetmux.Ghostty.service"
mkdir -p "$apps_dir" "$units_dir"
install -m 0644 "$REPO/config/dev.vscodetmux.Ghostty.desktop" "$apps_dir/dev.vscodetmux.Ghostty.desktop"
install -m 0644 "$REPO/config/$ghostty_unit" "$units_dir/$ghostty_unit"
command -v update-desktop-database >/dev/null && update-desktop-database "$apps_dir" 2>/dev/null || true
log "installed $apps_dir/dev.vscodetmux.Ghostty.desktop and $units_dir/$ghostty_unit"

ghostty_version="$(ghostty --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
case "$ghostty_version" in
  '') ;;
  1.[0-2].*) warn "Ghostty $ghostty_version: the quake dropdown needs 1.3+ (global keybinds on GTK). ctrl+\` will not work." ;;
esac
if [[ "$desktop" == *GNOME* ]]; then
  warn "GNOME: the quick terminal needs wlr-layer-shell, which Mutter does not implement. The companion will open a normal window instead."
fi

if command -v systemctl >/dev/null; then
  systemctl --user daemon-reload
  if command -v ghostty >/dev/null; then
    systemctl --user enable "$ghostty_unit" >/dev/null 2>&1 || warn "could not enable $ghostty_unit"
    if systemctl --user is-active --quiet "$ghostty_unit"; then
      log "restarting companion Ghostty on the new config"
      systemctl --user restart "$ghostty_unit" || warn "restart failed; see: systemctl --user status $ghostty_unit"
    else
      systemctl --user start "$ghostty_unit" || warn "could not start $ghostty_unit; see: journalctl --user -u $ghostty_unit"
    fi
  else
    warn "Ghostty missing: installed $ghostty_unit but not starting it"
  fi
else
  warn "no systemctl: start the companion yourself with 'ghostty --class=dev.vscodetmux.Ghostty --config-file=$HOME/.config/vscode-tmux/ghostty.conf'"
fi

# 8. Extension ---------------------------------------------------------------
vsix="$REPO/packages/extension/vscode-tmux.vsix"
if command -v code >/dev/null; then
  log "installing extension into $(command -v code)"
  code --install-extension "$vsix" --force
else
  warn "'code' not on PATH; install the extension manually: code --install-extension $vsix"
fi

# 9. (Re)start the daemon on the new build --------------------------------------
unit="vscode-tmux-$(id -u)"
sock="/run/user/$(id -u)/vscode-tmux.sock"
if [[ -S "$sock" ]]; then
  log "stopping running daemon"
  # A daemon started detached (no systemd) is found through its own status reply; never pkill by pattern.
  pid="$("$daemon_bin" status 2>/dev/null | sed -n 's/^ *"pid": \([0-9]*\),*$/\1/p' | head -n 1)"
  systemctl --user stop "$unit.service" 2>/dev/null || true
  if [[ -S "$sock" && -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; fi
  sleep 1
fi
if command -v systemd-run >/dev/null && systemd-run --user --collect --quiet --unit="$unit" --setenv=PATH="$PATH" "$daemon_bin" daemon 2>/dev/null; then
  log "daemon started as transient user unit $unit"
else
  nohup "$daemon_bin" daemon >/dev/null 2>&1 &
  disown
  log "daemon started (detached)"
fi
sleep 2
"$daemon_bin" status >/dev/null && log "daemon answers on $sock" || warn "daemon did not answer; check ~/.local/state/vscode-tmux/daemon.log"

cat <<EOT

Done. Next:
  1. Reload your VS Code windows (Developer: Reload Window) so the extension connects.
  2. Press ctrl+\` : Ghostty drops down from the top with the tabs of the focused VS Code window.
     The first time, Plasma asks whether "VS Code Tmux Terminal" may register global shortcuts — accept it.
     The binding then lives in System Settings > Shortcuts > VS Code Tmux Terminal (CTRL+grave).
  3. In a tab run:  vscode src/some/file.ts:42
  Diagnostics: vscode-tmux status, vscode-tmux toggle, journalctl --user -u $ghostty_unit,
               ~/.local/state/vscode-tmux/daemon.log
  Dropdown size/position: quick-terminal-* in ~/.config/vscode-tmux/ghostty.conf, then
               systemctl --user restart $ghostty_unit
EOT
