#!/bin/bash
# Installs the built app into /Applications, replacing any previous copy.
# Boards are stored in ~/Library/WebKit/local.milanote-clone, not in the bundle, so they're kept.
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="build/Milanote Clone.app"
DEST="/Applications/Milanote Clone.app"
[[ -d "$SRC" ]] || { echo "Build the app first: npm run build:mac"; exit 1; }

# Quit the running app (it saves on quit) before swapping the bundle.
was_running=false
if pgrep -f "Milanote Clone.app/Contents/MacOS/MilanoteClone" >/dev/null; then
  was_running=true
  osascript -e 'quit app id "local.milanote-clone"'
  for _ in {1..20}; do pgrep -f "Milanote Clone.app/Contents/MacOS/MilanoteClone" >/dev/null || break; sleep 0.25; done
fi

# Replace rather than merge: copying over an old bundle leaves stale files that break its signature.
rm -rf "$DEST"
ditto "$SRC" "$DEST"
codesign --verify "$DEST"
echo "Installed $DEST"
if $was_running; then open "$DEST"; fi
