import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { DnsQueryLogEntry, DnsStats } from "../types/connection";

const POLL_INTERVAL_MS = 2000;

export function useDnsCapture() {
  const [log, setLog] = useState<DnsQueryLogEntry[]>([]);
  const [stats, setStats] = useState<DnsStats>({
    total_queries: 0,
    unique_domains: 0,
    blocked_count: 0,
    recent_rate: 0,
  });

  const poll = useCallback(async () => {
    try {
      const [newLog, newStats] = await Promise.all([
        invoke<DnsQueryLogEntry[]>("get_dns_log"),
        invoke<DnsStats>("get_dns_stats"),
      ]);
      setLog(newLog);
      setStats(newStats);
    } catch {
      // DNS capture may not be running (no elevation)
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  return { log, stats };
}
