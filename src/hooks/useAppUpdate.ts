import { useState, useEffect, useCallback } from "react";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
  version: string;
  body: string;
}

export function useAppUpdate() {
  const [available, setAvailable] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Check for updates on mount and every 30 minutes
  useEffect(() => {
    const checkForUpdate = async () => {
      try {
        const update = await check();
        if (update) {
          setAvailable(true);
          setUpdateInfo({
            version: update.version,
            body: update.body ?? "",
          });
        }
      } catch (e) {
        // Silently fail — update checks are best-effort
        console.debug("Update check failed:", e);
      }
    };

    // Initial check after 5 seconds (let app load first)
    const initial = setTimeout(checkForUpdate, 5000);
    // Periodic check every 30 minutes
    const interval = setInterval(checkForUpdate, 30 * 60 * 1000);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, []);

  const installUpdate = useCallback(async () => {
    setDownloading(true);
    setError(null);
    try {
      const update = await check();
      if (!update) {
        setError("Update no longer available");
        setDownloading(false);
        return;
      }

      let downloaded = 0;
      let contentLength = 0;

      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            contentLength = event.data.contentLength ?? 0;
            break;
          case "Progress":
            downloaded += event.data.chunkLength;
            if (contentLength > 0) {
              setProgress(Math.round((downloaded / contentLength) * 100));
            }
            break;
          case "Finished":
            setProgress(100);
            break;
        }
      });

      // Relaunch the app after update
      await relaunch();
    } catch (e) {
      setError(String(e));
      setDownloading(false);
    }
  }, []);

  const dismiss = useCallback(() => {
    setAvailable(false);
    setUpdateInfo(null);
  }, []);

  return { available, updateInfo, downloading, progress, error, installUpdate, dismiss };
}
