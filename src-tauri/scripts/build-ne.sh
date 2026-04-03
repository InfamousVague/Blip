#!/bin/bash
# Build the Blip Network Extension and NE Manager tool.
# Called automatically during `cargo tauri build` via beforeBuildCommand.
#
# Prerequisites: Full Xcode installed (developer machine only — end users don't need this)
#
# Outputs:
#   resources/blip-ne-manager                                    — Swift CLI for NE activation
#   resources/com.infamousvague.blip.network-extension.systemextension/  — System extension bundle

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")"
NE_DIR="$TAURI_DIR/BlipNetworkExtension"
SWIFT_DIR="$TAURI_DIR/swift"
RESOURCES_DIR="$TAURI_DIR/resources"
BUILD_DIR="$TAURI_DIR/target/ne-build"

# Check for Xcode — if not available, use pre-built NE binary if it exists
if ! xcode-select -p 2>/dev/null | grep -q "Xcode.app"; then
    SYSEXT_DIR="$RESOURCES_DIR/com.infamousvague.blip.network-extension.systemextension"
    if [ -d "$SYSEXT_DIR" ] && [ -f "$SYSEXT_DIR/Contents/MacOS/com.infamousvague.blip.network-extension" ]; then
        echo "Full Xcode not detected, but NE binary already exists — skipping rebuild."
        # Still update the version in Info.plist
        APP_VERSION=$(node -e "console.log(require('$TAURI_DIR/tauri.conf.json').version)" 2>/dev/null || echo "")
        if [ -n "$APP_VERSION" ]; then
            BUILD_NUMBER=$(date +%s)
            plutil -replace CFBundleShortVersionString -string "$APP_VERSION" "$SYSEXT_DIR/Contents/Info.plist" 2>/dev/null || true
            plutil -replace CFBundleVersion -string "$BUILD_NUMBER" "$SYSEXT_DIR/Contents/Info.plist" 2>/dev/null || true
            echo "NE version updated to $APP_VERSION ($BUILD_NUMBER)"
        fi
        exit 0
    fi
    echo "WARNING: Full Xcode not detected and no pre-built NE binary found."
    echo "Network Extension requires Xcode. Skipping NE build."
    echo "Install Xcode from the App Store to enable NE support."
    exit 0
fi

mkdir -p "$BUILD_DIR" "$RESOURCES_DIR"

echo "=== Building BlipNEBridge dylib ==="

# Build the NE bridge as a dynamic library loaded by the main app process.
# This is required because macOS only allows the containing .app to submit
# system extension requests — a separate CLI tool can't do it.
swiftc \
    -O \
    -sdk "$(xcrun --show-sdk-path)" \
    -target arm64-apple-macos12.0 \
    -emit-library \
    -module-name BlipNEBridge \
    -framework Foundation \
    -framework NetworkExtension \
    -framework SystemExtensions \
    -o "$RESOURCES_DIR/libblip_ne_bridge.dylib" \
    "$SWIFT_DIR/BlipNEBridge.swift"

# Fix install name so the app can find it
install_name_tool -id "@rpath/libblip_ne_bridge.dylib" "$RESOURCES_DIR/libblip_ne_bridge.dylib"

echo "Built: $RESOURCES_DIR/libblip_ne_bridge.dylib"

echo "=== Building blip-ne-manager (fallback CLI) ==="

# Keep the CLI tool as a fallback for debugging
swiftc \
    -O \
    -sdk "$(xcrun --show-sdk-path)" \
    -target arm64-apple-macos12.0 \
    -framework Foundation \
    -framework NetworkExtension \
    -framework SystemExtensions \
    -o "$RESOURCES_DIR/blip-ne-manager" \
    "$SWIFT_DIR/BlipNEManager.swift"

echo "Built: $RESOURCES_DIR/blip-ne-manager"

echo "=== Building BlipNetworkExtension ==="

# Build the system extension
NE_BUILD_DIR="$BUILD_DIR/ne"
mkdir -p "$NE_BUILD_DIR"

# Compile all Swift sources into the NE binary
swiftc \
    -O \
    -sdk "$(xcrun --show-sdk-path)" \
    -target arm64-apple-macos12.0 \
    -framework Foundation \
    -framework NetworkExtension \
    -parse-as-library \
    -module-name BlipNetworkExtension \
    -o "$NE_BUILD_DIR/com.infamousvague.blip.network-extension" \
    "$NE_DIR/Sources/NEEventTypes.swift" \
    "$NE_DIR/Sources/FlowByteTracker.swift" \
    "$NE_DIR/Sources/DNSHelpers.swift" \
    "$NE_DIR/Sources/RuleEngine.swift" \
    "$NE_DIR/Sources/BlipFilterProvider.swift" \
    "$NE_DIR/Sources/BlipDNSProvider.swift" \
    "$NE_DIR/Sources/SocketBridge.swift" \
    "$NE_DIR/Sources/main.swift"

# Create .systemextension bundle in resources/ so Tauri bundles it
SYSEXT_DIR="$RESOURCES_DIR/com.infamousvague.blip.network-extension.systemextension"
rm -rf "$SYSEXT_DIR"
mkdir -p "$SYSEXT_DIR/Contents/MacOS"

cp "$NE_BUILD_DIR/com.infamousvague.blip.network-extension" \
   "$SYSEXT_DIR/Contents/MacOS/"
cp "$NE_DIR/Info.plist" "$SYSEXT_DIR/Contents/"

# Sync NE version from tauri.conf.json so macOS replaces the system extension on updates.
# macOS only replaces a system extension when CFBundleShortVersionString or CFBundleVersion changes.
APP_VERSION=$(node -e "console.log(require('$TAURI_DIR/tauri.conf.json').version)" 2>/dev/null || echo "")
if [ -n "$APP_VERSION" ]; then
    # Use a timestamp-based build number to ensure it always increments
    BUILD_NUMBER=$(date +%s)
    plutil -replace CFBundleShortVersionString -string "$APP_VERSION" "$SYSEXT_DIR/Contents/Info.plist"
    plutil -replace CFBundleVersion -string "$BUILD_NUMBER" "$SYSEXT_DIR/Contents/Info.plist"
    echo "NE version set to $APP_VERSION ($BUILD_NUMBER)"
fi

echo "Built: $SYSEXT_DIR"
echo "=== NE build complete ==="
