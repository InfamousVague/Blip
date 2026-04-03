/**
 * Shim for @tauri-apps/api/window — provides a no-op getCurrentWindow
 * for the native Xcode build where window dragging is handled by AppKit.
 */

export function getCurrentWindow() {
  return {
    startDragging: () => {
      // No-op in native app — AppKit handles titlebar dragging
    },
  };
}
