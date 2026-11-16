#!/bin/bash
# macOS: removes the "local.jarvis-os" LaunchAgent and stops the server it started. Does nothing if it is not there.
label=local.jarvis-os
plist="$HOME/Library/LaunchAgents/$label.plist"
if [ -f "$plist" ]; then
  launchctl bootout "gui/$(id -u)/$label" 2>/dev/null
  rm -f "$plist"
  echo "Agent '$label' removed."
else
  echo "Agent '$label' not found. Nothing to do."
fi
