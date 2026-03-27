import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CaptureSnapshot, ResolvedConnection } from "../types/connection";

const POLL_INTERVAL_MS = 1000;

export function useNetworkCapture() {
  const [connections, setConnections] = useState<ResolvedConnection[]>([]);
  const [totalEver, setTotalEver] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const snapshot = await invoke<CaptureSnapshot>("get_connections");
      setConnections(snapshot.connections);
      setTotalEver(snapshot.total_ever);
    } catch (e) {
      console.error("[Blip] Poll failed:", e);
    }
  }, []);

  const startCapture = useCallback(async () => {
    try {
      await invoke("start_capture");
      setCapturing(true);
      // Start polling
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = setInterval(poll, POLL_INTERVAL_MS);
      // Immediate first poll
      poll();
      console.log("[Blip] Capture started, polling every", POLL_INTERVAL_MS, "ms");
    } catch (e) {
      console.error("[Blip] Failed to start capture:", e);
    }
  }, [poll]);

  const stopCapture = useCallback(async () => {
    try {
      await invoke("stop_capture");
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
      setCapturing(false);
      setConnections([]);
      setTotalEver(0);
      console.log("[Blip] Capture stopped");
    } catch (e) {
      console.error("[Blip] Failed to stop capture:", e);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  return {
    connections,
    totalEver,
    capturing,
    startCapture,
    stopCapture,
  };
}
