/**
 * Bridge shim — replaces @tauri-apps/api/core with our WKWebView bridge.
 * The native Swift side registers window.blip.invoke() via WKScriptMessageHandler.
 */

export async function invoke<T = any>(command: string, args?: Record<string, unknown>): Promise<T> {
  // Use our WKWebView bridge if available (native app)
  if (typeof window !== "undefined" && (window as any).blip?.invoke) {
    return (window as any).blip.invoke(command, args || {});
  }

  // Fallback: try Tauri invoke (for dev mode if still using Tauri)
  try {
    const tauri = await import("@tauri-apps/api/core");
    return tauri.invoke(command, args);
  } catch {
    console.warn(`No bridge available for command: ${command}`);
    throw new Error(`Bridge not available`);
  }
}

/**
 * No-op Channel shim — Tauri plugins use this for streaming callbacks.
 * In our native app, we use polling instead.
 */
export class Channel<T = unknown> {
  onmessage: ((message: T) => void) | undefined;
  constructor() {}
}

/**
 * No-op checkPermissions shim — permissions are handled natively.
 */
export async function checkPermissions(_plugin?: string): Promise<Record<string, string>> {
  return { location: "granted" };
}
