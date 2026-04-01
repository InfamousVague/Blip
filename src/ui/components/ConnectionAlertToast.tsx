/**
 * ConnectionAlertToast — Glass banner alert for new firewall connections.
 * Horizontal single-row layout: dot · title · app → dest (proto) [Allow] [Block] [×]
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
    <FrostedCard className={`blip-alert-toast ${className}`} padding={14} gap={0} style={style}>
      <div className="blip-alert-toast__row">
        <div className="blip-alert-toast__info">
          <span className="blip-alert-toast__dot" />
          <span className="blip-alert-toast__title">New Connection</span>
          <span className="blip-alert-toast__sep">·</span>
          <span className="blip-alert-toast__app">{appName}</span>
          <span className="blip-alert-toast__arrow">→</span>
          <span className="blip-alert-toast__dest">{destination}</span>
          <span className="blip-alert-toast__protocol">({protocol})</span>
        </div>
        <div className="blip-alert-toast__actions">
          <button className="blip-alert-toast__btn blip-alert-toast__btn--allow" onClick={onAllow}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" dangerouslySetInnerHTML={{ __html: CHECK_ICON }} />
            Allow
          </button>
          <button className="blip-alert-toast__btn blip-alert-toast__btn--block" onClick={onBlock}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" dangerouslySetInnerHTML={{ __html: X_ICON }} />
            Block
          </button>
          <button
            className="blip-alert-toast__close"
            onClick={onDismiss}
            aria-label="Dismiss"
            dangerouslySetInnerHTML={{
              __html: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none">${CLOSE_ICON}</svg>`,
            }}
          />
        </div>
      </div>
    </FrostedCard>
  );
}
