import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { TracedRoute } from "../types/connection";

const POLL_INTERVAL_MS = 10_000; // Poll for new traced routes every 10s

export function useRouteTracing() {
  const [tracedRoutes, setTracedRoutes] = useState<Map<string, TracedRoute>>(new Map());
  const [tracing, setTracing] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Poll for all cached traced routes
  const poll = useCallback(async () => {
    try {
      const routes = await invoke<Record<string, TracedRoute>>("get_all_traced_routes");
      setTracedRoutes(new Map(Object.entries(routes)));
    } catch {
      // Command not available or failed
    }
  }, []);

  // Manually trace a specific destination
  const traceRoute = useCallback(async (destIp: string) => {
    setTracing(true);
    try {
      const route = await invoke<TracedRoute>("trace_route", { destIp });
      setTracedRoutes((prev) => {
        const next = new Map(prev);
        next.set(route.dest_ip, route);
        return next;
      });
    } catch (e) {
      console.warn("Trace route failed:", e);
    }
    setTracing(false);
  }, []);

  // Initial load + periodic polling
  useEffect(() => {
    poll();
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [poll]);

  return { tracedRoutes, traceRoute, tracing };
}
