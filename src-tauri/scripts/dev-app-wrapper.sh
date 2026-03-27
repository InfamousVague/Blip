#!/bin/bash
# Create a minimal .app bundle for dev mode that includes the NE system extension.
# This allows NE activation during cargo tauri dev.
#
# Creates: target/debug/Blip.app/
#   Contents/MacOS/app          — symlink to the actual debug binary
#   Contents/Library/SystemExtensions/  — the .systemextension bundle
#   Contents/Resources/resources/       — symlink to src-tauri/resources/
#   Contents/Info.plist

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")"
TARGET_DIR="$TAURI_DIR/target/debug"
APP_DIR="$TARGET_DIR/Blip.app"
RESOURCES_DIR="$TAURI_DIR/resources"
SYSEXT_NAME="com.infamousvague.blip.network-extension.systemextension"

# Only create if NE was built
if [ ! -d "$RESOURCES_DIR/$SYSEXT_NAME" ]; then
    echo "NE not built yet, skipping dev app wrapper"
    exit 0
fi

# Create .app structure
mkdir -p "$APP_DIR/Contents/MacOS"
mkdir -p "$APP_DIR/Contents/Library/SystemExtensions"
mkdir -p "$APP_DIR/Contents/Resources"

# Symlink the binary
ln -sf "$TARGET_DIR/app" "$APP_DIR/Contents/MacOS/app"

# Symlink resources
ln -sf "$RESOURCES_DIR" "$APP_DIR/Contents/Resources/resources"

# Copy system extension (can't symlink — macOS validates bundle structure)
rm -rf "$APP_DIR/Contents/Library/SystemExtensions/$SYSEXT_NAME"
cp -R "$RESOURCES_DIR/$SYSEXT_NAME" "$APP_DIR/Contents/Library/SystemExtensions/"

# Create minimal Info.plist
cat > "$APP_DIR/Contents/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.infamousvague.blip</string>
    <key>CFBundleName</key>
    <string>Blip</string>
    <key>CFBundleDisplayName</key>
    <string>Blip</string>
    <key>CFBundleExecutable</key>
    <string>app</string>
    <key>CFBundleVersion</key>
    <string>0.1.0</string>
    <key>CFBundleShortVersionString</key>
    <string>0.1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>12.0</string>
    <key>NSSystemExtensionUsageDescription</key>
    <string>Blip uses a network extension to monitor connections.</string>
</dict>
</plist>
PLIST

echo "Dev app wrapper created: $APP_DIR"
echo "To test NE in dev mode, launch: open $APP_DIR"
