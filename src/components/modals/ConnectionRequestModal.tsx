/**
 * ConnectionRequestModal — Prompted when an unknown app connects for the first time.
 * Shows approve/deny buttons with connection details.
 * Uses Modal variant="glass" for settings-matching frosted glass.
 */

import { useState } from 'react';
import { Modal } from '../../ui/components/Modal';
import { FrostedCard } from '../../ui/glass/FrostedCard';
import { Button } from '../../ui/components/Button';
import type { FirewallAlert } from '../../hooks/useFirewallAlerts';
import './ConnectionRequestModal.css';

function getAppDisplayName(appId: string): string {
  const parts = appId.split('.');
  const last = parts[parts.length - 1] || appId;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

interface Props {
  alert: FirewallAlert | null;
  queueLength: number;
  onAllow: (alert: FirewallAlert, remember: boolean) => void;
  onDeny: (alert: FirewallAlert, remember: boolean) => void;
  onDismiss: () => void;
}

export function ConnectionRequestModal({ alert, queueLength, onAllow, onDeny, onDismiss }: Props) {
  const [remember, setRemember] = useState(false);

  if (!alert) return null;

  const appName = getAppDisplayName(alert.appId);

  return (
    <Modal open onClose={onDismiss} width={440} variant="glass">
      <FrostedCard padding={20} gap={16}>
        <div className="conn-modal__header">
          <div className="conn-modal__title-row">
            <span className="conn-modal__icon conn-modal__icon--warning" />
            <span className="conn-modal__title">New Connection Request</span>
            {queueLength > 1 && (
              <span className="conn-modal__queue-badge">{queueLength} pending</span>
            )}
          </div>
          <span className="conn-modal__desc">
            <strong>{appName}</strong> is requesting network access for the first time.
          </span>
        </div>

        <div className="conn-modal__details">
          <div className="conn-modal__detail-row">
            <span className="conn-modal__detail-label">Process</span>
            <span className="conn-modal__detail-value">{appName}</span>
          </div>
          <div className="conn-modal__detail-row">
            <span className="conn-modal__detail-label">Destination</span>
            <span className="conn-modal__detail-value">{alert.destIp}</span>
          </div>
          <div className="conn-modal__detail-row">
            <span className="conn-modal__detail-label">Port</span>
            <span className="conn-modal__detail-value">
              {alert.destPort}{alert.destPort === 443 ? ' (HTTPS)' : alert.destPort === 80 ? ' (HTTP)' : ''}
            </span>
          </div>
          <div className="conn-modal__detail-row">
            <span className="conn-modal__detail-label">Protocol</span>
            <span className="conn-modal__detail-value">{alert.protocol.toUpperCase()}</span>
          </div>
        </div>
      </FrostedCard>

      <div className="conn-modal__footer">
        <label className="conn-modal__remember">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="conn-modal__checkbox"
          />
          <span>Remember for this app</span>
        </label>
        <div className="conn-modal__buttons">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { onDeny(alert, remember); setRemember(false); }}
            className="conn-modal__btn--deny"
          >
            Deny
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => { onAllow(alert, remember); setRemember(false); }}
            className="conn-modal__btn--allow"
          >
            Approve
          </Button>
        </div>
      </div>
    </Modal>
  );
}
