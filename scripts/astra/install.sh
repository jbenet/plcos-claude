#!/usr/bin/env bash
# Install or remove the Astra runner as a login item (docs/30-astra-runner.md). Runs as you, so it starts at login
# and restarts if it stops; nothing here asks Claude for anything.
#
#   bash scripts/astra/install.sh            install and start (from the live checkout)
#   bash scripts/astra/install.sh remove     stop and remove
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
LABEL=com.plcos.astra-runner
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$(cd "$REPO/../plcos-data/real" && pwd)/workflows/astra"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
if [ "${1:-}" = remove ]; then rm -f "$PLIST"; echo "Astra runner stopped and removed."; exit 0; fi
mkdir -p "$HOME/Library/LaunchAgents" "$LOGDIR"
NPM="$(command -v npm)"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NPM</string><string>run</string><string>astra</string></array>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>$(dirname "$NPM"):/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$LOGDIR/runner.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/runner.log</string>
</dict></plist>
PLIST
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Astra runner installed and started. Watch it on Developer → Astra; its log is $LOGDIR/runner.log."
