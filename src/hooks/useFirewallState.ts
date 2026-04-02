import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FirewallState, FirewallMode } from "../types/firewall";

export function useFirewallState() {
  const [state, setState] = useState<FirewallState>({
    mode: "ask",
    kill_switch_active: false,
    active_profile_id: "default",
    wizard_completed: false,
  });

  const fetchState = useCallback(async () => {
    try {
      const s = await invoke<FirewallState>("get_firewall_state");
      setState(s);
    } catch {}
  }, []);

  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 2000);
    return () => clearInterval(interval);
  }, [fetchState]);

  const setMode = useCallback(async (mode: FirewallMode) => {
    try {
      await invoke("set_preference", { key: "firewall_mode", value: mode });
      setState((s) => ({ ...s, mode }));
    } catch {}
  }, []);

  const toggleKillSwitch = useCallback(async (active: boolean) => {
    try {
      await invoke("toggle_kill_switch", { active });
      setState((s) => ({ ...s, kill_switch_active: active }));
    } catch {}
  }, []);

  const switchProfile = useCallback(async (profileId: string) => {
    try {
      await invoke("switch_network_profile", { id: profileId });
      setState((s) => ({ ...s, active_profile_id: profileId }));
    } catch {}
  }, []);

  const completeWizard = useCallback(async () => {
    try {
      await invoke("complete_setup_wizard");
      setState((s) => ({ ...s, wizard_completed: true }));
    } catch {}
  }, []);

  return { state, setMode, toggleKillSwitch, switchProfile, completeWizard, refresh: fetchState };
}
