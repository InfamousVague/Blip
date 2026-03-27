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

  return { samples, totalIn, totalOut };
}
