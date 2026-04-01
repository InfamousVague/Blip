import { useState, useEffect, useCallback, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { onAction } from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface FirewallAlert {
  id: string;
  appId: string;
  destIp: string;
  destPort: number;
  protocol: string;
  timestamp: number;
}

interface NewAppPayload {
  app_id: string;
  dest_ip: string;
  dest_port: number;
  protocol: string;
}

const ALERT_TIMEOUT_MS = 30_000;

export function useFirewallAlerts(mode: string) {
  const [alerts, setAlerts] = useState<FirewallAlert[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Auto-dismiss after timeout
  const scheduleAutoDismiss = useCallback((id: string) => {
    const timer = setTimeout(() => {
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      timersRef.current.delete(id);
    }, ALERT_TIMEOUT_MS);
    timersRef.current.set(id, timer);
  }, []);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  // Focus window when user clicks a macOS notification
  useEffect(() => {
    const listenerPromise = onAction(() => {
      const win = getCurrentWindow();
      win.show();
      win.setFocus();
    });
    return () => { listenerPromise.then((l) => l.unregister()); };
  }, []);

  useEffect(() => {
    if (mode !== "alert") {
      // Clear alerts when leaving alert mode
      setAlerts([]);
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      return;
    }

    const unlisten = listen<NewAppPayload>("firewall-new-app", (event) => {
      const payload = event.payload;
      const id = `${payload.app_id}-${Date.now()}`;
      const alert: FirewallAlert = {
        id,
        appId: payload.app_id,
        destIp: payload.dest_ip,
        destPort: payload.dest_port,
        protocol: payload.protocol,
        timestamp: Date.now(),
      };
      setAlerts((prev) => [...prev, alert]);
      scheduleAutoDismiss(id);
    });

    return () => {
      unlisten.then((fn) => fn());
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, [mode, scheduleAutoDismiss]);

  return { alerts, dismissAlert };
}
