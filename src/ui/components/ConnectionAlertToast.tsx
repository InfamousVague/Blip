/**
 * ConnectionAlertToast — Glass card alert for new firewall connections.
 * Shows app name, destination, and Allow/Block buttons.
 */

import { FrostedCard } from '../glass';
import type { CSSProperties } from 'react';
import './ConnectionAlertToast.css';

const CHECK_ICON = '<path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
const X_ICON = '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
const CLOSE_ICON = '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

interface ConnectionAlertToastProps {
  appName: string;
  destination: string;
  protocol?: string;
  onAllow: () => void;
  onBlock: () => void;
  onDismiss: () => void;
  className?: string;
  style?: CSSProperties;
}

export function ConnectionAlertToast({
  appName,
  destination,
  protocol = 'TCP',
  onAllow,
  onBlock,
  onDismiss,
  className = '',
  style,
}: ConnectionAlertToastProps) {
  return (
    <FrostedCard className={`blip-alert-toast ${className}`} padding={16} gap={10} style={style}>
      {/* Header: warning dot + title + close */}
      <div className="blip-alert-toast__header">
        <div className="blip-alert-toast__header-left">
          <span className="blip-alert-toast__dot" />
          <span className="blip-alert-toast__title">New Connection</span>
        </div>
        <button
          className="blip-alert-toast__close"
          onClick={onDismiss}
          aria-label="Dismiss"
          dangerouslySetInnerHTML={{
            __html: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none">${CLOSE_ICON}</svg>`,
          }}
        />
      </div>

      {/* Content: app name + destination + actions */}
      <div className="blip-alert-toast__content">
        <div className="blip-alert-toast__body">
          <span className="blip-alert-toast__app">{appName}</span>
          <span className="blip-alert-toast__dest">{destination} ({protocol})</span>
        </div>
        <div className="blip-alert-toast__actions">
          <button className="blip-alert-toast__btn blip-alert-toast__btn--allow" onClick={onAllow}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" dangerouslySetInnerHTML={{ __html: CHECK_ICON }} />
            Allow
          </button>
          <button className="blip-alert-toast__btn blip-alert-toast__btn--block" onClick={onBlock}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" dangerouslySetInnerHTML={{ __html: X_ICON }} />
            Block
          </button>
        </div>
      </div>
    </FrostedCard>
  );
}
