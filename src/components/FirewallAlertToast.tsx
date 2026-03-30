import { Button } from "@mattmattmattmatt/base/primitives/button/Button";
import { Text } from "@mattmattmattmatt/base/primitives/text/Text";
import { Icon } from "@mattmattmattmatt/base/primitives/icon/Icon";
import { shieldAlert } from "@mattmattmattmatt/base/primitives/icon/icons/shield-alert";
import { x } from "@mattmattmattmatt/base/primitives/icon/icons/x";
import "@mattmattmattmatt/base/primitives/button/button.css";
import "@mattmattmattmatt/base/primitives/text/text.css";
import "@mattmattmattmatt/base/primitives/icon/icon.css";
import type { FirewallAlert } from "../hooks/useFirewallAlerts";
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
        <div key={alert.id} className="fw-alert-card">
          <button
            className="fw-alert-card__close"
            onClick={() => onDismiss(alert.id)}
            aria-label="Dismiss"
          >
            <Icon icon={x} size="xs" />
          </button>

          <div className="fw-alert-card__header">
            <Icon icon={shieldAlert} size="sm" />
            <Text size="sm" weight="semibold">New Connection</Text>
          </div>

          <div className="fw-alert-card__body">
            <Text size="sm" weight="medium">
              {getAppDisplayName(alert.appId)}
            </Text>
            <Text size="xs" color="tertiary" font="mono">
              {alert.destIp}:{alert.destPort} ({alert.protocol.toUpperCase()})
            </Text>
          </div>

          <div className="fw-alert-card__actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onAllow(alert)}
              style={{ color: "var(--color-success)" }}
            >
              Allow
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onDeny(alert)}
              style={{ color: "var(--color-error)" }}
            >
              Block
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
