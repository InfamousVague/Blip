import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface BandwidthSample {
  time: number; // seconds since start
  bytesIn: number; // bytes/sec
  bytesOut: number; // bytes/sec
}

const MAX_SAMPLES = 60; // 60 seconds of history

export function useBandwidth(capturing: boolean) {
  const [samples, setSamples] = useState<BandwidthSample[]>([]);
  const [totalIn, setTotalIn] = useState(0);
  const [totalOut, setTotalOut] = useState(0);
  const prevIn = useRef(0);
  const prevOut = useRef(0);
  const startTime = useRef(Date.now());
  const initialized = useRef(false);

  useEffect(() => {
    if (!capturing) return;

    startTime.current = Date.now();
    initialized.current = false;

    const interval = setInterval(async () => {
      try {
        const [cumIn, cumOut] = await invoke<[number, number]>("get_bandwidth");

        if (!initialized.current) {
          // First sample — just record baseline
          prevIn.current = cumIn;
          prevOut.current = cumOut;
          initialized.current = true;
          return;
        }

        const deltaIn = Math.max(0, cumIn - prevIn.current);
        const deltaOut = Math.max(0, cumOut - prevOut.current);
        prevIn.current = cumIn;
        prevOut.current = cumOut;

        setTotalIn((t) => t + deltaIn);
        setTotalOut((t) => t + deltaOut);

        const elapsed = (Date.now() - startTime.current) / 1000;

        setSamples((prev) => {
          const next = [...prev, { time: elapsed, bytesIn: deltaIn, bytesOut: deltaOut }];
          return next.length > MAX_SAMPLES ? next.slice(-MAX_SAMPLES) : next;
        });
      } catch (e) {
        // Ignore errors (e.g., before Tauri is ready)
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [capturing]);

  // Bandwidth threshold alerts
  const alertCooldown = useRef(0); // prevent spam: cooldown timestamp
  const exceededCount = useRef(0); // consecutive seconds above threshold
  useEffect(() => {
    if (samples.length === 0) return;
    const latest = samples[samples.length - 1];
    const now = Date.now();
    if (now < alertCooldown.current) { exceededCount.current = 0; return; }

    // Check thresholds (stored as Mbps, convert to bytes/sec)
    (async () => {
      try {
        const dlEnabled = await invoke<string | null>("get_preference", { key: "alert_download_enabled" });
        const ulEnabled = await invoke<string | null>("get_preference", { key: "alert_upload_enabled" });
        const dlThreshold = parseFloat((await invoke<string | null>("get_preference", { key: "alert_threshold_download_mbps" })) || "100");
        const ulThreshold = parseFloat((await invoke<string | null>("get_preference", { key: "alert_threshold_upload_mbps" })) || "50");

        const dlBytesThreshold = dlThreshold * 1000000 / 8; // Mbps → bytes/sec
        const ulBytesThreshold = ulThreshold * 1000000 / 8;

        let exceeded = false;
        if (dlEnabled !== "false" && latest.bytesIn > dlBytesThreshold) exceeded = true;
        if (ulEnabled !== "false" && latest.bytesOut > ulBytesThreshold) exceeded = true;

        if (exceeded) {
          exceededCount.current++;
          if (exceededCount.current >= 10) {
            // Sustained for 10 seconds — alert
            exceededCount.current = 0;
            alertCooldown.current = now + 300000; // 5 minute cooldown
            const msg = `Bandwidth alert: ${(latest.bytesIn * 8 / 1000000).toFixed(1)} Mbps down, ${(latest.bytesOut * 8 / 1000000).toFixed(1)} Mbps up`;
            console.warn(msg);
            // Try sending macOS notification
            try {
              const { sendNotification } = await import("@tauri-apps/plugin-notification");
              sendNotification({ title: "Blip — Bandwidth Alert", body: msg });
            } catch { /* notification not available */ }
          }
        } else {
          exceededCount.current = 0;
        }
      } catch { /* ignore preference read errors */ }
    })();
  }, [samples]);

  return { samples, totalIn, totalOut };
}
