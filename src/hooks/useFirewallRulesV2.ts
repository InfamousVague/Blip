import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import type {
  FirewallRule,
  AppInfo,
  AppWithRules,
  NewRuleRequest,
  RuleConflict,
} from "../types/firewall";

export function useFirewallRulesV2(profileId?: string) {
  const [rules, setRules] = useState<FirewallRule[]>([]);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [iconMap, setIconMap] = useState<globalThis.Map<string, string>>(new globalThis.Map());
  const resolvedBundleIds = useRef<Set<string>>(new Set());

  const fetchAll = useCallback(async () => {
    try {
      const [rulesData, appsData] = await Promise.all([
        invoke<FirewallRule[]>("get_firewall_rules_v2", { profileId: profileId || null }),
        invoke<AppInfo[]>("get_app_registry"),
      ]);
      setRules(rulesData);
      setApps(appsData);

      // Resolve icons for new bundle IDs
      const newIds = appsData
        .map((a) => a.app_id)
        .filter((id) => !resolvedBundleIds.current.has(id));
      if (newIds.length > 0) {
        newIds.forEach((id) => resolvedBundleIds.current.add(id));
        try {
          const icons = await invoke<Record<string, string>>("get_app_icons", { bundleIds: newIds });
          if (Object.keys(icons).length > 0) {
            setIconMap((prev) => {
              const next = new globalThis.Map(prev);
              for (const [bid, path] of Object.entries(icons)) {
                next.set(bid, path);
              }
              return next;
            });
          }
        } catch {}
      }
    } catch (e) {
      console.error("Failed to fetch firewall data:", e);
    }
  }, [profileId]);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const createRule = useCallback(async (req: NewRuleRequest) => {
    const rule = await invoke<FirewallRule>("create_firewall_rule_v2", { rule: req });
    fetchAll();
    return rule;
  }, [fetchAll]);

  const updateRule = useCallback(async (id: string, updates: Partial<FirewallRule>) => {
    const rule = await invoke<FirewallRule>("update_firewall_rule_v2", { id, ...updates });
    fetchAll();
    return rule;
  }, [fetchAll]);

  const deleteRule = useCallback(async (id: string) => {
    await invoke("delete_firewall_rule_v2", { id });
    fetchAll();
  }, [fetchAll]);

  const checkConflicts = useCallback(async (req: NewRuleRequest): Promise<RuleConflict[]> => {
    return invoke<RuleConflict[]>("check_rule_conflicts", { rule: req });
  }, []);

  // Group rules by app
  const rulesByApp = new globalThis.Map<string, FirewallRule[]>();
  for (const r of rules) {
    const list = rulesByApp.get(r.app_id) || [];
    list.push(r);
    rulesByApp.set(r.app_id, list);
  }

  const appsWithRules: AppWithRules[] = apps.map((app) => {
    const appRules = rulesByApp.get(app.app_id) || [];
    const blanketRule = appRules.find(
      (r) => !r.domain_pattern && !r.port && !r.protocol
    ) || null;
    return {
      app,
      rules: appRules,
      blanketRule,
      iconUrl: iconMap.get(app.app_id) || null,
    };
  });

  return {
    apps: appsWithRules,
    rules,
    createRule,
    updateRule,
    deleteRule,
    checkConflicts,
    refresh: fetchAll,
  };
}
