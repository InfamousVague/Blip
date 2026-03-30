import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

export interface FirewallRule {
  id: string;
  app_id: string;
  app_name: string;
  app_path: string | null;
  action: "allow" | "deny" | "unspecified";
  domain: string | null;
  port: number | null;
  protocol: string | null;
  expires_at: number | null;
  lifetime: string;
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
  /** The blanket (unscoped) rule for this app, if any */
  rule: FirewallRule | null;
  /** All rules for this app including scoped ones */
  rules: FirewallRule[];
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

  const setRule = useCallback(async (
    appId: string,
    appName: string,
    action: "allow" | "deny" | "unspecified",
    opts?: { domain?: string; port?: number; protocol?: string; lifetime?: string; durationMins?: number },
  ) => {
    try {
      if (action === "unspecified" && !opts?.domain && !opts?.port && !opts?.protocol) {
        await invoke("delete_firewall_rule", { appId });
      } else {
        await invoke("set_firewall_rule", {
          appId,
          appName,
          appPath: null,
          action,
          domain: opts?.domain ?? null,
          port: opts?.port ?? null,
          protocol: opts?.protocol ?? null,
          lifetime: opts?.lifetime ?? null,
          durationMins: opts?.durationMins ?? null,
        });
      }
      fetchAll();
    } catch (e) {
      console.error("Failed to set firewall rule:", e);
    }
  }, [fetchAll]);

  const deleteRuleById = useCallback(async (id: string) => {
    try {
      await invoke("delete_firewall_rule_by_id", { id });
      fetchAll();
    } catch (e) {
      console.error("Failed to delete firewall rule:", e);
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
  // Group rules by app_id
  const rulesByApp = new Map<string, FirewallRule[]>();
  for (const r of rules) {
    const list = rulesByApp.get(r.app_id) || [];
    list.push(r);
    rulesByApp.set(r.app_id, list);
  }

  const appsWithRules: AppWithRule[] = apps.map(app => {
    const appRules = rulesByApp.get(app.app_id) || [];
    // Blanket rule = one with no domain/port/protocol scoping
    const blanketRule = appRules.find(r => !r.domain && !r.port && !r.protocol) || null;
    return {
      ...app,
      rule: blanketRule,
      rules: appRules,
      action: blanketRule?.action || "unspecified",
      iconUrl: iconMap.get(app.app_id) || null,
    };
  });

  return {
    apps: appsWithRules,
    rules,
    mode,
    setRule,
    setMode,
    deleteRuleById,
    refresh: fetchAll,
  };
}
