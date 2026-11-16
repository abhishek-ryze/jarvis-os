#!/bin/bash
# macOS: adds a per-user LaunchAgent "local.jarvis-os" that runs `node server.js` at login. No admin needed.
# Safe to run again: it replaces the existing agent. Undo with scripts/uninstall-autostart.sh.
set -euo pipefail
label=local.jarvis-os
url=http://127.0.0.1:4317
dir="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(uname)" = Darwin ] || { echo 'This script is for macOS. On Windows use install-autostart.ps1.' >&2; exit 1; }
[ -f "$dir/server.js" ] || { echo "server.js not found in $dir" >&2; exit 1; }
node="$(command -v node || true)"
[ -n "$node" ] || { echo 'node not found on PATH. Install Node first.' >&2; exit 1; }

plist="$HOME/Library/LaunchAgents/$label.plist"
log="$HOME/Library/Logs/jarvis-os.log"
xml() { sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' <<<"$1"; }

# launchd starts agents with a bare PATH, so keep this shell's PATH (claude, git) and CLAUDE_CONFIG_DIR.
extra=''
[ -n "${CLAUDE_CONFIG_DIR:-}" ] && extra="<key>CLAUDE_CONFIG_DIR</key><string>$(xml "$CLAUDE_CONFIG_DIR")</string>"
mkdir -p "$(dirname "$plist")" "$(dirname "$log")"
cat >"$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$(xml "$node")</string><string>server.js</string></array>
  <key>WorkingDirectory</key><string>$(xml "$dir")</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(xml "$PATH")</string>$extra</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$(xml "$log")</string>
  <key>StandardErrorPath</key><string>$(xml "$log")</string>
</dict>
</plist>
EOF

domain="gui/$(id -u)"
# A reinstall stops our own server first; the wait lets launchd finish unloading before bootstrap.
if launchctl bootout "$domain/$label" 2>/dev/null; then sleep 2; fi
if lsof -nP -iTCP:4317 -sTCP:LISTEN >/dev/null 2>&1; then
  echo 'Port 4317 is already in use (server running?). Agent saved; it will start at next login.'
else
  launchctl bootstrap "$domain" "$plist"
fi
echo "Agent '$label' installed (node: $node, log: $log)."
echo "Dashboard: $url"
