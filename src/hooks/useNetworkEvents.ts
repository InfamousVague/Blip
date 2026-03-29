import { useEffect, useRef, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CaptureSnapshot, ResolvedConnection } from "../types/connection";

interface ConnectionsDelta {
  generation: number;
  updated: ResolvedConnection[];
  removed: string[];
  total_ever: number;
}

const POLL_INTERVAL_MS = 1500;
const SLOW_POLL_INTERVAL_MS = 3000;

export function useNetworkCapture(activeTab: string = "network") {
  const [connections, setConnections] = useState<ResolvedConnection[]>([]);
  const [totalEver, setTotalEver] = useState(0);
  const [capturing, setCapturing] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const connMap = useRef<Map<string, ResolvedConnection>>(new Map());
  const generation = useRef(0);
  const initialized = useRef(false);

  const poll = useCallback(async () => {
    // Pause polling when window is hidden
    if (document.hidden) return;

    try {
      if (!initialized.current) {
        // First poll: get full snapshot
        const snapshot = await invoke<CaptureSnapshot>("get_connections");
        connMap.current.clear();
        for (const conn of snapshot.connections) {
          connMap.current.set(conn.id, conn);
        }
        setConnections(snapshot.connections);
        setTotalEver(snapshot.total_ever);
        initialized.current = true;
        // Get current generation
        const delta = await invoke<ConnectionsDelta>("get_connections_delta", { since: 0 });
        generation.current = delta.generation;
      } else {
        // Subsequent polls: get only changes
        const delta = await invoke<ConnectionsDelta>("get_connections_delta", { since: generation.current });
        if (delta.updated.length > 0 || delta.removed.length > 0) {
          for (const conn of delta.updated) {
            connMap.current.set(conn.id, conn);
          }
          for (const id of delta.removed) {
            connMap.current.delete(id);
          }
          generation.current = delta.generation;
          setConnections(Array.from(connMap.current.values()));
        }
        if (delta.total_ever !== totalEver) {
          setTotalEver(delta.total_ever);
        }
      }
    } catch (e) {
      console.error("[Blip] Poll failed:", e);
    }
  }, [totalEver]);

  const startCapture = useCallback(async () => {
    try {
      await invoke("start_capture");
      setCapturing(true);
      initialized.current = false;
      // Choose poll interval based on active tab
      const interval = activeTab === "network" ? POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = setInterval(poll, interval);
      poll();
    } catch (e) {
      console.error("[Blip] Failed to start capture:", e);
    }
  }, [poll, activeTab]);

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
      connMap.current.clear();
      initialized.current = false;
      generation.current = 0;
    } catch (e) {
      console.error("[Blip] Failed to stop capture:", e);
    }
  }, []);

  // Adjust poll interval when tab changes
  useEffect(() => {
    if (!capturing || !pollTimer.current) return;
    const interval = activeTab === "network" ? POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
    clearInterval(pollTimer.current);
    pollTimer.current = setInterval(poll, interval);
  }, [activeTab, capturing, poll]);

  // Auto-start capture on mount
  useEffect(() => {
    startCapture();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [startCapture]);

  return {
    connections,
    totalEver,
    capturing,
    startCapture,
    stopCapture,
  };
}
