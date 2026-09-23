#!/usr/bin/env bash
# Toggle the companion dropdown between full height and a short strip.
# Bound to F11 in tmux.conf (tmux sees F11 because Ghostty does not bind it).
#
# Ghostty reads quick-terminal-size only when a quick-terminal window maps for
# the first time; a config reload keeps an existing window at its old size and
# toggle_fullscreen is a no-op on a layer-shell surface. So: rewrite the size in
# the deployed config, reload it, close the window, and press ctrl+` again so a
# fresh window comes up at the new size. The tmux client in the dropdown dies
# with the window; the server and its sessions do not, and the daemon's
# client-attached hook puts the new client back on the right session.
set -u

CONFIG="${VSCODE_TMUX_GHOSTTY_CONF:-$HOME/.config/vscode-tmux/ghostty.conf}"
# Full height must be pixels: Ghostty sizes from the whole monitor and sets no
# layer-shell exclusive zone, so 100% under a top panel runs off the screen.
FULL="${VSCODE_TMUX_DROPDOWN_FULL:-1048px}"
SHORT="${VSCODE_TMUX_DROPDOWN_SHORT:-45%}"
UNIT=app-dev.vscodetmux.Ghostty.service
APP_PATH=/dev/vscodetmux/Ghostty

die() { printf 'quick-terminal-height: %s\n' "$*" >&2; exit 1; }

[[ -f $CONFIG ]] || die "no config at $CONFIG"

# 1. Flip the size.
current=$(sed -n 's/^quick-terminal-size *= *//p' "$CONFIG" | tail -1)
if [[ $current == "$FULL" ]]; then next=$SHORT; else next=$FULL; fi
if grep -q '^quick-terminal-size *=' "$CONFIG"; then
  sed -i "s/^quick-terminal-size *=.*/quick-terminal-size = $next/" "$CONFIG"
else
  printf 'quick-terminal-size = %s\n' "$next" >>"$CONFIG"
fi

# 2. Find the companion on the session bus. It owns no well-known name
#    (single-instance is off), so match the unique name to the unit's PID.
pid=$(systemctl --user show -p MainPID --value "$UNIT" 2>/dev/null)
[[ ${pid:-0} -gt 0 ]] || die "$UNIT is not running; size written, takes effect on start"
dest=$(busctl --user list --no-legend 2>/dev/null | awk -v pid="$pid" '$2 == pid { print $1; exit }')
[[ -n $dest ]] || die "pid $pid owns no bus name; restart $UNIT to apply $next"

gdbus call --session --dest "$dest" --object-path "$APP_PATH" \
  --method org.gtk.Actions.Activate reload-config '[]' '{}' >/dev/null \
  || die "reload-config failed; restart $UNIT to apply $next"

# 3. Close the current dropdown window, if there is one.
window() {
  gdbus introspect --session --dest "$dest" --object-path "$APP_PATH/window" --recurse 2>/dev/null \
    | grep -oE "$APP_PATH/window/[0-9]+" | head -1
}
win=$(window)
# No window: nothing is on screen, the next ctrl+` already uses the new size.
[[ -n $win ]] || exit 0

gdbus call --session --dest "$dest" --object-path "$win" \
  --method org.gtk.Actions.Activate close '[]' '{}' >/dev/null \
  || die "close failed on $win"
for _ in $(seq 40); do
  [[ -z $(window) ]] && break
  sleep 0.05
done

# 4. Press ctrl+` so Ghostty builds a new window at the new size. The hotkey is
#    a portal global shortcut; KDE files it under the ghostty_ghostty component.
gdbus call --session --dest org.kde.kglobalaccel --object-path /component/ghostty_ghostty \
  --method org.kde.kglobalaccel.Component.invokeShortcut 'CTRL+grave' >/dev/null \
  || die "could not press ctrl+\` via kglobalaccel; press it yourself"
