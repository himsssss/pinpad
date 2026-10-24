#!/bin/bash
# Builds "build/Pinpad.app": the web app plus the native Swift shell.
set -euo pipefail
cd "$(dirname "$0")/.."

APP="build/Pinpad.app"
VERSION=$(node -p "require('./package.json').version")

npm run build

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

# Universal binary (Apple silicon + Intel).
for arch in arm64 x86_64; do
  swiftc -O -swift-version 5 -target "$arch-apple-macos13.3" macos/main.swift -o "build/Pinpad-$arch"
done
lipo -create build/Pinpad-arm64 build/Pinpad-x86_64 -output "$APP/Contents/MacOS/Pinpad"
rm build/Pinpad-arm64 build/Pinpad-x86_64

# The icon only changes with make-icon.swift, so it's cached between builds.
if [[ ! -f build/AppIcon.icns || macos/make-icon.swift -nt build/AppIcon.icns ]]; then
  rm -rf build/AppIcon.iconset
  swift macos/make-icon.swift build/AppIcon.iconset
  iconutil -c icns build/AppIcon.iconset -o build/AppIcon.icns
  rm -rf build/AppIcon.iconset
fi
cp build/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"

sed "s/__VERSION__/$VERSION/g" macos/Info.plist > "$APP/Contents/Info.plist"
cp -R dist "$APP/Contents/Resources/web"

# Ad-hoc signature so macOS will run it locally.
codesign --force --sign - "$APP"

echo "Built $APP"
