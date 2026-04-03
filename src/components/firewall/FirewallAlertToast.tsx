import { ConnectionAlertToast } from "../../ui/components/ConnectionAlertToast";
import type { FirewallAlert } from "../../hooks/useFirewallAlerts";
import "./FirewallAlertToast.css";

function getAppDisplayName(appId: string): string {
  const parts = appId.split(".");
  const last = parts[parts.length - 1] || appId;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

interface Props {
  alerts: FirewallAlert[];
  onAllow: (alert: FirewallAlert) => void;
  onDeny: (alert: FirewallAlert) => void;
  onDismiss: (id: string) => void;
}

export function FirewallAlertOverlay({ alerts, onAllow, onDeny, onDismiss }: Props) {
  if (alerts.length === 0) return null;

  return (
    <div className="fw-alert-overlay">
      {alerts.map((alert) => (
        <ConnectionAlertToast
          key={alert.id}
          appName={getAppDisplayName(alert.appId)}
          destination={`${alert.destIp}:${alert.destPort}`}
          protocol={alert.protocol.toUpperCase()}
          onAllow={() => onAllow(alert)}
          onBlock={() => onDeny(alert)}
          onDismiss={() => onDismiss(alert.id)}
        />
      ))}
    </div>
  );
}
