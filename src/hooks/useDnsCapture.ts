import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { BlockedAttempt, DnsQueryLogEntry, DnsStats } from "../types/connection";

const POLL_INTERVAL_MS = 3000;
const BLOCKED_POLL_MS = 5000;

export function useDnsCapture(visible: boolean) {
  const [log, setLog] = useState<DnsQueryLogEntry[]>([]);
  const [stats, setStats] = useState<DnsStats>({
    total_queries: 0,
    unique_domains: 0,
    blocked_count: 0,
    recent_rate: 0,
  });
  const [blockedAttempts, setBlockedAttempts] = useState<BlockedAttempt[]>([]);

  const poll = useCallback(async () => {
    try {
      if (visible) {
        const [newLog, newStats] = await Promise.all([
          invoke<DnsQueryLogEntry[]>("get_dns_log"),
          invoke<DnsStats>("get_dns_stats"),
        ]);
        setLog(newLog);
        setStats(newStats);
      } else {
        const newStats = await invoke<DnsStats>("get_dns_stats");
        setStats(newStats);
      }
    } catch {
      // DNS capture may not be running
    }
  }, [visible]);

  // Poll blocked attempts with geo coordinates (for map arcs)
  const pollBlocked = useCallback(async () => {
    try {
      const attempts = await invoke<BlockedAttempt[]>("get_blocked_attempts");
      setBlockedAttempts(attempts);
    } catch {
      // GeoIP may not be loaded yet
    }
  }, []);

  useEffect(() => {
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    pollBlocked();
    const id = setInterval(pollBlocked, BLOCKED_POLL_MS);
    return () => clearInterval(id);
  }, [pollBlocked]);

  return { log, stats, blockedAttempts };
}
