#!/bin/zsh
# Keeps the Designer Job Search server running in the background, starting at login, so automatic
# pulls happen even when the dashboard is closed. macOS LaunchAgent; affects only this user.
#   scripts/login-item.sh install     start now and at every login
#   scripts/login-item.sh uninstall   stop and remove
#   scripts/login-item.sh status
set -e
LABEL="local.designer-job-search"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
LOG_DIR="$HOME/Library/Logs/designer-job-search"

case "${1:-status}" in
  install)
    [ -n "$NODE" ] || { echo "Node is not installed."; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$LOG_DIR"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP_DIR/server.mjs</string></array>
  <key>WorkingDirectory</key><string>$APP_DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG_DIR/server.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/server.log</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed. Designer Job Search runs at http://localhost:4340/ and pulls on its own."
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed. Start it by hand with: node server.mjs"
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then echo "Running at login: yes"; else echo "Running at login: no"; fi
    ;;
  *) echo "Use: install, uninstall or status"; exit 1 ;;
esac
