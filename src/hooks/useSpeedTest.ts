import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface SpeedTestResult {
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  timestamp_ms: number;
}

interface SpeedTestProgress {
  stage: "ping" | "download" | "download_done" | "upload" | "done";
  mbps: number;
  percent: number;
}

const TEST_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const INITIAL_DELAY_MS = 5_000; // 5 seconds after mount

export function useSpeedTest() {
  const [downloadMbps, setDownloadMbps] = useState(0);
  const [uploadMbps, setUploadMbps] = useState(0);
  const [pingMs, setPingMs] = useState(0);
  const [testing, setTesting] = useState(false);
  const [lastTestTime, setLastTestTime] = useState(0);

  // Live progress state
  const [stage, setStage] = useState<"idle" | "ping" | "download" | "upload">("idle");
  const [liveDownloadMbps, setLiveDownloadMbps] = useState(0);
  const [liveUploadMbps, setLiveUploadMbps] = useState(0);
  const [percent, setPercent] = useState(0);

  const testingRef = useRef(false);

  const runTest = useCallback(async () => {
    if (testingRef.current) return;
    testingRef.current = true;
    setTesting(true);
    setStage("ping");
    setPercent(0);
    setLiveDownloadMbps(0);
    setLiveUploadMbps(0);
    try {
      const result = await invoke<SpeedTestResult>("run_speed_test");
      setDownloadMbps(result.download_mbps);
      setUploadMbps(result.upload_mbps);
      setPingMs(result.ping_ms);
      setLastTestTime(result.timestamp_ms);
      // Set live values to final so they persist in the card
      setLiveDownloadMbps(result.download_mbps);
      setLiveUploadMbps(result.upload_mbps);
    } catch (e) {
      console.warn("Speed test failed:", e);
    }
    testingRef.current = false;
    setTesting(false);
    setStage("idle");
  }, []);

  // Listen for progress events from Rust
  useEffect(() => {
    const unlistenPromise = listen<SpeedTestProgress>("speed-test-progress", (event) => {
      const { stage: s, mbps, percent: pct } = event.payload;
      setPercent(pct);

      if (s === "ping") {
        setStage("ping");
      } else if (s === "download") {
        setStage("download");
        if (mbps > 0) setLiveDownloadMbps(mbps);
      } else if (s === "download_done") {
        // Lock in the final download result before upload starts
        if (mbps > 0) {
          setLiveDownloadMbps(mbps);
          setDownloadMbps(mbps);
        }
      } else if (s === "upload") {
        setStage("upload");
        if (mbps > 0) setLiveUploadMbps(mbps);
      } else if (s === "done") {
        setStage("idle");
      }
    });

    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // Load cached result on mount, then schedule auto-runs
  useEffect(() => {
    let cancelled = false;

    // Load cached result first
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

    // Initial test after short delay
    const initialTimer = setTimeout(() => {
      if (!cancelled) runTest();
    }, INITIAL_DELAY_MS);

    // Recurring test every 15 minutes
    const intervalId = setInterval(() => {
      if (!cancelled) runTest();
    }, TEST_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(initialTimer);
      clearInterval(intervalId);
    };
  }, [runTest]);

  return {
    downloadMbps,
    uploadMbps,
    pingMs,
    testing,
    lastTestTime,
    runTest,
    // Live progress
    stage,
    liveDownloadMbps,
    liveUploadMbps,
    percent,
  };
}
