import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface PortEntry {
  port: number;
  protocol: string;
  state: string;
  pid: number;
  process_name: string;
  command: string;
  connections: number;
}

const POLL_INTERVAL_MS = 3000;

export function useListeningPorts(active: boolean) {
  const [ports, setPorts] = useState<PortEntry[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await invoke<PortEntry[]>("get_listening_ports");
      setPorts(data);
    } catch (e) {
      console.warn("Failed to fetch listening ports:", e);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      return;
    }
    refresh();
    intervalRef.current = setInterval(refresh, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [active, refresh]);

  const killProcess = useCallback(async (pid: number) => {
    try {
      await invoke<boolean>("kill_process", { pid });
      // Refresh immediately after kill
      await refresh();
    } catch (e) {
      console.error("Failed to kill process:", e);
      throw e;
    }
  }, [refresh]);

  return { ports, killProcess, refresh };
}
