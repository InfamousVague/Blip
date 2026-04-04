#!/bin/bash
# Post-build: Place .systemextension in the app bundle and re-sign everything
# with hardened runtime + secure timestamp for notarization.
# Run after `cargo tauri build`.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TAURI_DIR="$(dirname "$SCRIPT_DIR")"

# Find the built .app bundle
APP_BUNDLE=$(find "$TAURI_DIR/target/release/bundle/macos" -name "*.app" -maxdepth 1 2>/dev/null | head -1)

if [ -z "$APP_BUNDLE" ]; then
    echo "No .app bundle found in target/release/bundle/macos — skipping post-build"
    exit 0
fi

SYSEXT_NAME="com.infamousvague.blip.network-extension.systemextension"
SOURCE_SYSEXT="$TAURI_DIR/resources/$SYSEXT_NAME"
TARGET_DIR="$APP_BUNDLE/Contents/Library/SystemExtensions"

# Copy .systemextension from src-tauri/resources/ into the app bundle
if [ -d "$SOURCE_SYSEXT" ]; then
    mkdir -p "$TARGET_DIR"
    rm -rf "$TARGET_DIR/$SYSEXT_NAME"
    cp -R "$SOURCE_SYSEXT" "$TARGET_DIR/"
    echo "Placed $SYSEXT_NAME in $TARGET_DIR/"
else
    echo "WARNING: $SOURCE_SYSEXT not found — run scripts/build-ne.sh first"
    exit 0
fi

# Load signing identity from .env.apple
ENV_FILE="$TAURI_DIR/../.env.apple"
if [ -f "$ENV_FILE" ]; then
    source "$ENV_FILE"
fi

IDENTITY="${APPLE_SIGNING_IDENTITY:-}"

if [ -z "$IDENTITY" ]; then
    echo "WARNING: No APPLE_SIGNING_IDENTITY in .env.apple — skipping code signing"
    exit 0
fi

echo "=== Signing with: $IDENTITY ==="

# Embed provisioning profiles
APP_PROFILE="$HOME/Library/MobileDevice/Provisioning Profiles/Blip_Developer_ID.provisionprofile"
NE_PROFILE="$HOME/Library/MobileDevice/Provisioning Profiles/Blip_NE_Developer_ID.provisionprofile"

if [ -f "$NE_PROFILE" ]; then
    cp "$NE_PROFILE" "$TARGET_DIR/$SYSEXT_NAME/Contents/embedded.provisionprofile"
    echo "Embedded NE provisioning profile from ~/Library/MobileDevice"
elif [ -f "$TAURI_DIR/resources/$SYSEXT_NAME/Contents/embedded.provisionprofile" ]; then
    cp "$TAURI_DIR/resources/$SYSEXT_NAME/Contents/embedded.provisionprofile" \
       "$TARGET_DIR/$SYSEXT_NAME/Contents/embedded.provisionprofile"
    echo "Embedded NE provisioning profile from resources/"
else
    echo "WARNING: NE provisioning profile not found — NE activation will fail"
fi

if [ -f "$APP_PROFILE" ]; then
    cp "$APP_PROFILE" "$APP_BUNDLE/Contents/embedded.provisionprofile"
    echo "Embedded app provisioning profile"
else
    echo "WARNING: App provisioning profile not found at $APP_PROFILE"
fi

# Sign everything inside-out with hardened runtime + secure timestamp

# 1. System extension (innermost)
codesign --force --options runtime --timestamp \
    --sign "$IDENTITY" \
    --entitlements "$TAURI_DIR/BlipNetworkExtension/Entitlements.plist" \
    "$TARGET_DIR/$SYSEXT_NAME"
echo "Signed: $SYSEXT_NAME"

# 2. NE bridge dylib (must match main app's Team ID for dlopen)
NE_DYLIB="$APP_BUNDLE/Contents/Resources/resources/libblip_ne_bridge.dylib"
if [ -f "$NE_DYLIB" ]; then
    codesign --force --options runtime --timestamp \
        --sign "$IDENTITY" \
        --entitlements "$TAURI_DIR/Entitlements.plist" \
        "$NE_DYLIB"
    echo "Signed: libblip_ne_bridge.dylib (same Team ID as main app)"
fi

# 3. Helper binaries in Resources
for helper in blip-ne-manager blip-dns-helper wifi-scan; do
    HELPER_PATH="$APP_BUNDLE/Contents/Resources/resources/$helper"
    if [ -f "$HELPER_PATH" ]; then
        if [ "$helper" = "blip-ne-manager" ]; then
            # NE manager needs the app's NE entitlements to call NEFilterManager APIs
            codesign --force --options runtime --timestamp \
                --sign "$IDENTITY" \
                --entitlements "$TAURI_DIR/Entitlements.plist" \
                "$HELPER_PATH"
        else
            codesign --force --options runtime --timestamp \
                --sign "$IDENTITY" \
                "$HELPER_PATH"
        fi
        echo "Signed: $helper (Resources)"
    fi
done

# 3. Check for blip-dns-helper in MacOS/ (Tauri may copy it there too)
for helper in blip-dns-helper; do
    HELPER_PATH="$APP_BUNDLE/Contents/MacOS/$helper"
    if [ -f "$HELPER_PATH" ]; then
        codesign --force --options runtime --timestamp \
            --sign "$IDENTITY" \
            "$HELPER_PATH"
        echo "Signed: $helper (MacOS)"
    fi
done

# 4. Main app binary
codesign --force --options runtime --timestamp \
    --sign "$IDENTITY" \
    --entitlements "$TAURI_DIR/Entitlements.plist" \
    "$APP_BUNDLE/Contents/MacOS/app"
echo "Signed: main binary"

# 5. Re-sign the entire .app bundle (outermost, must be last)
# Do NOT use --deep as it invalidates nested framework signatures
codesign --force --options runtime --timestamp \
    --sign "$IDENTITY" \
    --entitlements "$TAURI_DIR/Entitlements.plist" \
    "$APP_BUNDLE"
echo "Signed: $APP_BUNDLE"

# Verify
echo ""
echo "=== Verification ==="
codesign --verify --deep --strict "$APP_BUNDLE" && echo "Signature valid" || echo "WARNING: Signature verification failed"

# Rebuild DMG with properly signed app
DMG_DIR="$TAURI_DIR/target/release/bundle/dmg"
# Read version from tauri.conf.json to match the Makefile's DMG name
VERSION=$(node -e "console.log(require('$TAURI_DIR/tauri.conf.json').version)" 2>/dev/null || echo "0.0.0")
DMG_PATH="$DMG_DIR/Blip_${VERSION}_aarch64.dmg"
if [ -d "$DMG_DIR" ]; then
    echo ""
    echo "=== Rebuilding DMG with signed app ==="
    rm -f "$DMG_PATH"
    # Create staging folder with app + Applications symlink for drag-to-install
    DMG_STAGE=$(mktemp -d)
    cp -R "$APP_BUNDLE" "$DMG_STAGE/"
    ln -s /Applications "$DMG_STAGE/Applications"
    hdiutil create -volname "Blip" -srcfolder "$DMG_STAGE" -ov -format UDZO "$DMG_PATH"
    rm -rf "$DMG_STAGE"
    # Sign the DMG
    codesign --force --sign "$IDENTITY" "$DMG_PATH"
    echo "DMG rebuilt and signed: $DMG_PATH"
fi

echo ""
echo "=== Post-build complete ==="
echo ""
echo "To notarize:"
echo "  xcrun notarytool submit '$(find "$TAURI_DIR/target/release/bundle/dmg" -name "*.dmg" | head -1)' \\"
echo "    --apple-id \"\$APPLE_ID\" --team-id \"\$APPLE_TEAM_ID\" --password \"\$APPLE_PASSWORD\" --wait"
echo ""
echo "Then staple:"
echo "  xcrun stapler staple '$(find "$TAURI_DIR/target/release/bundle/dmg" -name "*.dmg" | head -1)'"
