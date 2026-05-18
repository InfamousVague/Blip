import { useEffect, useState } from "react";

export interface DeepLinkTarget {
  raddr: string;
  rport?: number;
  laddr?: string;
  lport?: number;
  pid?: number;
  proto?: string;
}

/** Parse `blip://connection?raddr=…&rport=…&…` into a target. */
export function parseBlipUrl(url: string): DeepLinkTarget | null {
  try {
    const u = new URL(url);
    if (u.protocol !== "blip:") return null;
    if (u.hostname !== "connection") return null;
    const q = u.searchParams;
    const raddr = q.get("raddr");
    if (!raddr) return null;
    const num = (k: string) => {
      const v = q.get(k);
      return v != null && v !== "" ? Number(v) : undefined;
    };
    return {
      raddr,
      rport: num("rport"),
      laddr: q.get("laddr") ?? undefined,
      lport: num("lport"),
      pid: num("pid"),
      proto: q.get("proto") ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Latest `blip://connection` deep link, or null. Handles the cold-launch URL
 * and runtime opens. Defensive: if the deep-link plugin isn't available
 * (e.g. the native WKWebView shell), this is a no-op.
 */
export function useDeepLinkTarget(): DeepLinkTarget | null {
  const [target, setTarget] = useState<DeepLinkTarget | null>(null);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    (async () => {
      try {
        const dl = await import("@tauri-apps/plugin-deep-link");

        const current = await dl.getCurrent().catch(() => null);
        if (active && current && current.length > 0) {
          const t = parseBlipUrl(current[current.length - 1]);
          if (t) setTarget(t);
        }

        unlisten = await dl.onOpenUrl((urls: string[]) => {
          for (let i = urls.length - 1; i >= 0; i--) {
            const t = parseBlipUrl(urls[i]);
            if (t) {
              setTarget(t);
              break;
            }
          }
        });
      } catch {
        // deep-link plugin unavailable — integration simply inert
      }
    })();

    return () => {
      active = false;
      if (unlisten) unlisten();
    };
  }, []);

  return target;
}
