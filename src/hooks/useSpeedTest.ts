import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SpeedTestResult {
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  timestamp_ms: number;
}

const TEST_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const INITIAL_DELAY_MS = 10_000; // 10 seconds after mount

export function useSpeedTest() {
  const [downloadMbps, setDownloadMbps] = useState(0);
  const [uploadMbps, setUploadMbps] = useState(0);
  const [pingMs, setPingMs] = useState(0);
  const [testing, setTesting] = useState(false);
  const [lastTestTime, setLastTestTime] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const runTest = useCallback(async () => {
    if (testing) return;
    setTesting(true);
    try {
      const result = await invoke<SpeedTestResult>("run_speed_test");
      setDownloadMbps(result.download_mbps);
      setUploadMbps(result.upload_mbps);
      setPingMs(result.ping_ms);
      setLastTestTime(result.timestamp_ms);
    } catch (e) {
      console.warn("Speed test failed:", e);
    }
    setTesting(false);
  }, [testing]);

  // Load cached result on mount
  useEffect(() => {
    invoke<SpeedTestResult | null>("get_last_speed_test")
      .then((result) => {
        if (result) {
          setDownloadMbps(result.download_mbps);
          setUploadMbps(result.upload_mbps);
          setPingMs(result.ping_ms);
          setLastTestTime(result.timestamp_ms);
        }
      })
      .catch(() => {});
  }, []);

  // Auto-run: initial test after delay, then every 10 minutes
  useEffect(() => {
    const initialTimer = setTimeout(() => {
      runTest();
    }, INITIAL_DELAY_MS);

    intervalRef.current = setInterval(() => {
      runTest();
    }, TEST_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { downloadMbps, uploadMbps, pingMs, testing, lastTestTime, runTest };
}
