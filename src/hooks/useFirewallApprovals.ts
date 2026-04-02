import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { FirewallApprovalRequest, RuleLifetime } from "../types/firewall";

const AUTO_DISMISS_MS = 30_000;

export function useFirewallApprovals() {
  const [approvals, setApprovals] = useState<FirewallApprovalRequest[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new globalThis.Map());

  useEffect(() => {
    const unlisten = listen<FirewallApprovalRequest>("firewall-approval-request", (event) => {
      const request = event.payload;
      setApprovals((prev) => {
        // Dedupe by app_id + dest_ip + dest_port
        if (prev.some((a) =>
          a.app_id === request.app_id &&
          a.dest_ip === request.dest_ip &&
          a.dest_port === request.dest_port
        )) {
          return prev;
        }
        return [...prev, request];
      });

      // Auto-dismiss after 30s
      const timer = setTimeout(() => {
        setApprovals((prev) => prev.filter((a) => a.id !== request.id));
        timersRef.current.delete(request.id);
      }, AUTO_DISMISS_MS);
      timersRef.current.set(request.id, timer);
    });

    return () => {
      unlisten.then((fn) => fn());
      timersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const respond = useCallback(async (
    requestId: string,
    action: "allow" | "deny" | "dismiss",
    lifetime: RuleLifetime = "forever",
  ) => {
    // Find the approval to get its details
    const approval = approvals.find((a) => a.id === requestId);

    // Remove from UI
    setApprovals((prev) => prev.filter((a) => a.id !== requestId));
    const timer = timersRef.current.get(requestId);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(requestId);
    }

    if (!approval) return;

    try {
      await invoke("respond_to_approval", {
        requestId,
        action,
        lifetime,
        appId: approval.app_id,
        appName: approval.app_name,
        domain: approval.domain,
        destPort: approval.dest_port,
        protocol: approval.protocol,
      });
    } catch (e) {
      console.error("Failed to respond to approval:", e);
    }
  }, [approvals]);

  return { approvals, respond };
}
