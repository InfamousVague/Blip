#!/bin/bash
# Reinstall the Blip Network Extension
# This deactivates the old NE, removes cached copies, and reactivates from the current app bundle.
#
# Usage: ./src-tauri/scripts/reinstall-ne.sh
#
# Why this is needed:
# macOS caches system extensions aggressively. Even after installing a new app version,
# the old NE binary may still be running. This script forces a clean reinstall.

set -e

APP="/Applications/Blip.app"
NE_BUNDLE_ID="com.infamousvague.blip.network-extension"
NE_MANAGER="$APP/Contents/Resources/resources/blip-ne-manager"
NE_DEBUG_LOG="/private/var/tmp/blip-ne-debug.log"

echo "=== Blip Network Extension Reinstall ==="
echo ""

# Check app exists
if [ ! -d "$APP" ]; then
    echo "Error: Blip.app not found at $APP"
    echo "Install Blip first, then run this script."
    exit 1
fi

# Check NE manager exists
if [ ! -f "$NE_MANAGER" ]; then
    echo "Error: blip-ne-manager not found at $NE_MANAGER"
    exit 1
fi

# Step 1: Show current state
echo "1. Current system extension state:"
systemextensionsctl list 2>&1 | grep -i blip || echo "   No Blip extension found"
echo ""

# Step 2: Deactivate the old NE
echo "2. Deactivating old Network Extension..."
"$NE_MANAGER" deactivate 2>/dev/null || true
sleep 2

# Step 3: Kill any lingering NE processes
echo "3. Stopping lingering NE processes..."
sudo killall -9 "com.infamousvague.blip.network-extension" 2>/dev/null || true
sleep 1

# Step 4: Clear the NE debug log so we can verify the new one works
echo "4. Clearing NE debug log..."
> "$NE_DEBUG_LOG" 2>/dev/null || true

# Step 5: Clear the NE socket
echo "5. Cleaning socket..."
rm -f /private/var/tmp/blip-ne.sock 2>/dev/null || true

# Step 6: Activate the new NE from current app bundle
echo "6. Activating Network Extension from $APP..."
echo "   (You may need to approve this in System Settings → Privacy & Security)"
"$NE_MANAGER" activate 2>/dev/null || true

# Wait for activation
echo "   Waiting for activation..."
sleep 5

# Step 7: Verify
echo ""
echo "7. New system extension state:"
systemextensionsctl list 2>&1 | grep -i blip || echo "   No Blip extension found"
echo ""

# Check if NE is sending data
if [ -s "$NE_DEBUG_LOG" ]; then
    echo "NE debug log is being written — extension is running."
    echo "Last few lines:"
    tail -3 "$NE_DEBUG_LOG"
else
    echo "NE debug log is empty — extension may not have started yet."
    echo "Check System Settings → Privacy & Security for approval prompts."
fi

echo ""
echo "Done. If the extension still shows as outdated in Blip,"
echo "try: sudo systemextensionsctl reset   (then reboot)"
