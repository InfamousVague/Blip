/**
 * ConnectionAlertToast v2 — Enhanced approval toast with domain, tracker badge, and lifetime selector.
 * Layout: App Icon · App Name → Domain:Port (Proto) [Tracker Badge] | Lifetime: [Once][Session][Forever] | [Allow] [Deny] [×]
 */

import { useState } from 'react';
import { FrostedCard } from '../glass';
import type { CSSProperties } from 'react';
import type { FirewallApprovalRequest, RuleLifetime } from '../../types/firewall';
import './ConnectionAlertToast.css';

const CHECK_ICON = '<path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
const X_ICON = '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>';
const CLOSE_ICON = '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const SHIELD_ICON = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="1.5" fill="none"/>';
const WARNING_ICON = '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="9" x2="12" y2="13" stroke="currentColor" stroke-width="1.5"/><line x1="12" y1="17" x2="12.01" y2="17" stroke="currentColor" stroke-width="2"/>';

const WELL_KNOWN_PORTS: Record<number, string> = {
  80: 'HTTP', 443: 'HTTPS', 53: 'DNS', 22: 'SSH', 21: 'FTP',
  25: 'SMTP', 110: 'POP3', 143: 'IMAP', 993: 'IMAPS', 995: 'POP3S',
  3306: 'MySQL', 5432: 'PostgreSQL', 6379: 'Redis', 27017: 'MongoDB',
  8080: 'HTTP-Alt', 8443: 'HTTPS-Alt',
};

// Legacy props interface for backwards compatibility
interface LegacyProps {
  appName: string;
  destination: string;
  protocol?: string;
  onAllow: () => void;
  onBlock: () => void;
  onDismiss: () => void;
  className?: string;
  style?: CSSProperties;
}

// New v2 props interface
interface V2Props {
  request: FirewallApprovalRequest;
  iconUrl?: string | null;
  onRespond: (action: "allow" | "deny" | "dismiss", lifetime: RuleLifetime) => void;
  className?: string;
  style?: CSSProperties;
}

type ConnectionAlertToastProps = LegacyProps | V2Props;

function isV2Props(props: ConnectionAlertToastProps): props is V2Props {
  return 'request' in props;
}

export function ConnectionAlertToast(props: ConnectionAlertToastProps) {
  const [lifetime, setLifetime] = useState<RuleLifetime>("forever");

  if (!isV2Props(props)) {
    // Legacy mode
    return (
      <FrostedCard className={`blip-alert-toast ${props.className || ''}`} padding={14} gap={0} style={props.style}>
        <div className="blip-alert-toast__row">
          <div className="blip-alert-toast__info">
            <span className="blip-alert-toast__dot" />
            <span className="blip-alert-toast__title">New Connection</span>
            <span className="blip-alert-toast__sep">·</span>
            <span className="blip-alert-toast__app">{props.appName}</span>
            <span className="blip-alert-toast__arrow">→</span>
            <span className="blip-alert-toast__dest">{props.destination}</span>
            <span className="blip-alert-toast__protocol">({props.protocol || 'TCP'})</span>
          </div>
          <div className="blip-alert-toast__actions">
            <button className="blip-alert-toast__btn blip-alert-toast__btn--allow" onClick={props.onAllow}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" dangerouslySetInnerHTML={{ __html: CHECK_ICON }} />
              Allow
            </button>
            <button className="blip-alert-toast__btn blip-alert-toast__btn--block" onClick={props.onBlock}>
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" dangerouslySetInnerHTML={{ __html: X_ICON }} />
              Block
            </button>
            <button className="blip-alert-toast__close" onClick={props.onDismiss} aria-label="Dismiss"
              dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none">${CLOSE_ICON}</svg>` }} />
          </div>
        </div>
      </FrostedCard>
    );
  }

  // V2 mode
  const { request, iconUrl, onRespond, className = '', style } = props;
  const displayName = request.app_name || request.app_id.split('.').pop() || request.app_id;
  const displayDomain = request.domain || request.dest_ip;
  const portLabel = WELL_KNOWN_PORTS[request.dest_port] || request.dest_port.toString();
  const proto = request.protocol.toUpperCase();

  return (
    <FrostedCard className={`blip-alert-toast blip-alert-toast--v2 ${className}`} padding={14} gap={0} style={style}>
      <div className="blip-alert-toast__row">
        {/* App info */}
        <div className="blip-alert-toast__info">
          {iconUrl ? (
            <img src={iconUrl} className="blip-alert-toast__icon" width={20} height={20} alt="" />
          ) : (
            <span className="blip-alert-toast__dot" />
          )}
          <span className="blip-alert-toast__app">{displayName}</span>
          <span className="blip-alert-toast__arrow">→</span>
          <span className="blip-alert-toast__dest">{displayDomain}</span>
          <span className="blip-alert-toast__port">:{portLabel}</span>
          <span className="blip-alert-toast__protocol">({proto})</span>

          {/* Tracker badge */}
          {request.is_tracker ? (
            <span className="blip-alert-toast__badge blip-alert-toast__badge--tracker" title={request.tracker_category || "Tracker"}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" dangerouslySetInnerHTML={{ __html: WARNING_ICON }} />
              Tracker
            </span>
          ) : (
            <span className="blip-alert-toast__badge blip-alert-toast__badge--clean">
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" dangerouslySetInnerHTML={{ __html: SHIELD_ICON }} />
              Clean
            </span>
          )}

          {request.is_background && (
            <span className="blip-alert-toast__badge blip-alert-toast__badge--bg">BG</span>
          )}
        </div>

        {/* Lifetime selector */}
        <div className="blip-alert-toast__lifetime">
          {(["once", "session", "forever"] as RuleLifetime[]).map((lt) => (
            <button
              key={lt}
              className={`blip-alert-toast__lt-btn ${lifetime === lt ? "blip-alert-toast__lt-btn--active" : ""}`}
              onClick={() => setLifetime(lt)}
            >
              {lt === "once" ? "Once" : lt === "session" ? "Session" : "Forever"}
            </button>
          ))}
        </div>

        {/* Actions */}
        <div className="blip-alert-toast__actions">
          <button className="blip-alert-toast__btn blip-alert-toast__btn--allow" onClick={() => onRespond("allow", lifetime)}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" dangerouslySetInnerHTML={{ __html: CHECK_ICON }} />
            Allow
          </button>
          <button className="blip-alert-toast__btn blip-alert-toast__btn--block" onClick={() => onRespond("deny", lifetime)}>
            <svg viewBox="0 0 24 24" width="13" height="13" fill="none" dangerouslySetInnerHTML={{ __html: X_ICON }} />
            Deny
          </button>
          <button className="blip-alert-toast__close" onClick={() => onRespond("dismiss", "once")} aria-label="Dismiss"
            dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 24 24" width="12" height="12" fill="none">${CLOSE_ICON}</svg>` }} />
        </div>
      </div>
    </FrostedCard>
  );
}
