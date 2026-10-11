#!/bin/bash
# Verse Studio worker setup for macOS. Run from the repo folder: bash scripts/install-mac.sh
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
step() { printf "\n\033[33m== %s\033[0m\n" "$1"; }

step "Node.js"
if ! command -v node >/dev/null; then
  if command -v brew >/dev/null; then brew install node; else echo "Install Node.js 22 from https://nodejs.org then run this again."; exit 1; fi
fi
node --version

step "Xcode command line tools (needed once to build speech recognition)"
xcode-select -p >/dev/null 2>&1 || xcode-select --install || true

step "Claude Code"
command -v claude >/dev/null || [ -x "$HOME/.local/bin/claude" ] || curl -fsSL https://claude.ai/install.sh | bash
export PATH="$HOME/.local/bin:$PATH"

step "Installing packages"
npm install

step "Google credentials"
if [ ! -f apps/worker/.env ]; then
  cp apps/worker/.env.example apps/worker/.env
  open -W -e apps/worker/.env
fi

step "Log in to Claude (HER Claude Pro or Max account). Type /login if asked, then /exit."
read -r -p "Press Enter to open Claude" _
claude || true

step "Sign in to Google Drive (same Google account as the website)"
npm run login

step "Check-up"
npm run doctor || true

step "Start automatically at login"
PLIST="$HOME/Library/LaunchAgents/com.versestudio.worker.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/.verse-studio"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.versestudio.worker</string>
  <key>WorkingDirectory</key><string>$REPO</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>-lc</string><string>export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:\$PATH"; export VERSE_STUDIO_SUPERVISOR=launchd; if [ -f "$HOME/.verse-studio/update.flag" ]; then (git pull --ff-only &amp;&amp; npm install --no-audit --no-fund) &gt;&gt; "$HOME/.verse-studio/service.log" 2&gt;&amp;1; rm -f "$HOME/.verse-studio/update.flag"; fi; exec caffeinate -i npm run worker</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.verse-studio/service.log</string>
  <key>StandardErrorPath</key><string>$HOME/.verse-studio/service.log</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"
echo "Worker running. Log: ~/.verse-studio/worker.log"
