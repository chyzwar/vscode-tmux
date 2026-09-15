#!/usr/bin/env bash
# VS Code Tmux — one-shot installer for Ubuntu/Debian.
#
#   ./install.bash [--no-apt] [--no-vscode-deb] [--force-config]
#
# What it does (idempotent):
#   1. apt: tmux, xdotool, curl (needs sudo)
#   2. VS Code as a .deb from Microsoft (needs sudo; skipped with --no-vscode-deb or if already a deb)
#   3. Ghostty: checks it is installed, prints a hint otherwise
#   4. Bun (compiles the daemon), Node >= 26 via nodenv/nvm (yarn 4, extension build, tests),
#      corepack + yarn 4, `yarn install && yarn build`
#   5. CLI: copies the daemon binary to ~/.local/bin/vscode-tmux, symlinks ~/.local/bin/vscode
#   6. Configs: ~/.config/vscode-tmux/{tmux.conf,ghostty.conf} (kept if present unless --force-config)
#   7. Installs the extension .vsix into VS Code
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NO_APT=0; NO_VSCODE_DEB=0; FORCE_CONFIG=0
for arg in "$@"; do
  case "$arg" in
    --no-apt) NO_APT=1 ;;
    --no-vscode-deb) NO_VSCODE_DEB=1 ;;
    --force-config) FORCE_CONFIG=1 ;;
    -h|--help) sed -n '2,14p' "$0"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mwarning:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# 1. apt packages -----------------------------------------------------------
if [[ $NO_APT -eq 0 ]]; then
  if command -v apt-get >/dev/null; then
    missing=()
    for pkg in tmux xdotool curl; do dpkg -s "$pkg" >/dev/null 2>&1 || missing+=("$pkg"); done
    if [[ ${#missing[@]} -gt 0 ]]; then
      log "installing apt packages: ${missing[*]}"
      sudo apt-get update -qq
      sudo apt-get install -y "${missing[@]}"
    else
      log "apt packages present: tmux xdotool curl"
    fi
  else
    warn "apt-get not found; install tmux and xdotool yourself"
  fi
fi
command -v tmux >/dev/null || die "tmux is required"
command -v xdotool >/dev/null || warn "xdotool missing: VS Code windows will not be raised on open (code --goto fallback)"

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
if command -v ghostty >/dev/null; then
  log "Ghostty: $(ghostty --version 2>/dev/null | head -1)"
else
  warn "Ghostty not found. Install it (e.g. 'sudo snap install ghostty --classic' or the ghostty-ubuntu .deb) and re-run."
fi

# 4. Bun / Node / yarn / build ----------------------------------------------
export PATH="$HOME/.bun/bin:$PATH"
if ! command -v bun >/dev/null; then
  log "installing Bun (compiles the daemon; only touches ~/.bun and your shell rc)"
  curl -fsSL https://bun.sh/install | bash
  hash -r
fi
command -v bun >/dev/null || die "bun not found after install; install Bun (https://bun.sh) and re-run"
log "bun $(bun --version)"
if [[ -n "${NODENV_ROOT:-}" || -d "$HOME/.nodenv" ]]; then
  export PATH="$HOME/.nodenv/bin:$HOME/.nodenv/shims:$PATH"
  eval "$(nodenv init - 2>/dev/null || true)"
fi
if ! command -v node >/dev/null; then die "node not found; install Node >= 26 (nodenv/nvm/apt) and re-run (needed for yarn 4 and the extension build)"; fi
node_major="$(node -p 'process.versions.node.split(".")[0]')"
if (( node_major < 26 )); then
  if command -v nodenv >/dev/null && nodenv versions --bare 2>/dev/null | grep -q '^26\.'; then
    log "using node $(nodenv versions --bare | grep '^26\.' | tail -1) from nodenv"
  else
    warn "node $node_major found; the build tooling targets Node >= 26 (the repo pins 26 via .node-version)"
  fi
fi
cd "$REPO"
if ! command -v yarn >/dev/null || ! yarn --version 2>/dev/null | grep -q '^4\.'; then
  log "enabling corepack for yarn 4"
  if ! corepack --version >/dev/null 2>&1; then npm install -g corepack@latest >/dev/null; fi
  corepack enable
  command -v nodenv >/dev/null && nodenv rehash || true
  hash -r
fi
log "yarn install && yarn build"
yarn install
yarn build
( cd packages/extension && yarn package >/dev/null )

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

# 7. Extension ---------------------------------------------------------------
vsix="$REPO/packages/extension/vscode-tmux.vsix"
if command -v code >/dev/null; then
  log "installing extension into $(command -v code)"
  code --install-extension "$vsix" --force
else
  warn "'code' not on PATH; install the extension manually: code --install-extension $vsix"
fi

# 8. (Re)start the daemon on the new build --------------------------------------
unit="vscode-tmux-$(id -u)"
sock="/run/user/$(id -u)/vscode-tmux.sock"
if [[ -S "$sock" ]]; then
  log "stopping running daemon"
  # A daemon started detached (no systemd) is found through its own status reply; never pkill by pattern.
  pid="$("$daemon_bin" status 2>/dev/null | sed -n 's/^ *"pid": \([0-9]*\),*$/\1/p' | head -1)"
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

cat <<EOF

Done. Next:
  1. Reload your VS Code windows (Developer: Reload Window) so the extension connects.
  2. Focus a VS Code window: a Ghostty window titled "VS Code Tmux" appears with that workspace's tabs.
  3. In a tab run:  vscode src/some/file.ts:42
  Diagnostics: vscode-tmux status, vscode-tmux list, ~/.local/state/vscode-tmux/daemon.log
EOF
