import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface FirewallRule {
  id: string;
  app_id: string;
  app_name: string;
  app_path: string | null;
  action: "allow" | "deny" | "unspecified";
  created_at: number;
  updated_at: number;
}

export interface AppConnectionInfo {
  app_id: string;
  app_name: string;
  app_path: string | null;
  first_seen_ms: number;
  last_seen_ms: number;
  total_connections: number;
  is_apple_signed: boolean;
}

export interface AppWithRule extends AppConnectionInfo {
  rule: FirewallRule | null;
  action: "allow" | "deny" | "unspecified";
  iconUrl: string | null;
}

export function useFirewallRules() {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [apps, setApps] = useState<AppConnectionInfo[]>([]);
  const [mode, setModeState] = useState<string>("silent_allow");
  const [iconMap, setIconMap] = useState<Map<string, string>>(new Map());
  const resolvedBundleIds = useRef<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    try {
      const [rulesData, appsData, modeData] = await Promise.all([
        invoke<FirewallRule[]>("get_firewall_rules"),
        invoke<AppConnectionInfo[]>("get_app_list"),
        invoke<string>("get_firewall_mode"),
      ]);
      setRules(rulesData);
      setApps(appsData);
      setModeState(modeData);

      // Resolve icons for new bundle IDs we haven't looked up yet
      const newIds = appsData
        .map(a => a.app_id)
        .filter(id => !resolvedBundleIds.current.has(id));
      if (newIds.length > 0) {
        newIds.forEach(id => resolvedBundleIds.current.add(id));
        try {
          const icons = await invoke<Record<string, string>>("get_app_icons", { bundleIds: newIds });
          if (Object.keys(icons).length > 0) {
            setIconMap(prev => {
              const next = new Map(prev);
              for (const [bid, path] of Object.entries(icons)) {
                next.set(bid, path); // Already a data:image/png;base64 URI
              }
              return next;
            });
          }
        } catch {
          // Icon resolution is best-effort
        }
      }
    } catch (e) {
      console.error("Failed to fetch firewall data:", e);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const setRule = useCallback(async (appId: string, appName: string, action: "allow" | "deny" | "unspecified") => {
    try {
      if (action === "unspecified") {
        await invoke("delete_firewall_rule", { appId });
      } else {
        await invoke("set_firewall_rule", {
          appId,
          appName,
          appPath: null,
          action,
        });
      }
      fetchAll();
    } catch (e) {
      console.error("Failed to set firewall rule:", e);
    }
  }, [fetchAll]);

  const setMode = useCallback(async (newMode: string) => {
    try {
      await invoke("set_firewall_mode", { mode: newMode });
      setModeState(newMode);
    } catch (e) {
      console.error("Failed to set firewall mode:", e);
    }
  }, []);

  // Merge apps with rules and icons
  const rulesMap = new Map(rules.map(r => [r.app_id, r]));
  const appsWithRules: AppWithRule[] = apps.map(app => {
    const rule = rulesMap.get(app.app_id) || null;
    return {
      ...app,
      rule,
      action: rule?.action || "unspecified",
      iconUrl: iconMap.get(app.app_id) || null,
    };
  });

  return {
    apps: appsWithRules,
    rules,
    mode,
    setRule,
    setMode,
    refresh: fetchAll,
  };
}
