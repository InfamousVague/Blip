/**
 * DnsRow — DNS query log entry with domain, time, app, blocked status.
 */

import type { CSSProperties } from 'react';
import './DnsRow.css';

interface DnsRowProps {
  domain: string;
  timestamp: string;
  sourceApp?: string;
  responseIps?: string[];
  isBlocked?: boolean;
  blockedBy?: string;
  iconUrl?: string;
  className?: string;
  style?: CSSProperties;
}

export function DnsRow({
  domain,
  timestamp,
  sourceApp,
  responseIps,
  isBlocked = false,
  blockedBy,
  iconUrl,
  className = '',
  style,
}: DnsRowProps) {
  return (
    <div className={`blip-dns-row ${className}`} style={style}>
      <div className="blip-dns-row__main">
        <div className="blip-dns-row__left">
          <div className="blip-dns-row__icon">
            {iconUrl ? (
              <img src={iconUrl} alt="" className="blip-dns-row__img" />
            ) : (
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            )}
          </div>
          <span className={`blip-dns-row__domain ${isBlocked ? 'blip-dns-row__domain--blocked' : ''}`}>
            {domain}
          </span>
        </div>
        <span className="blip-dns-row__time">{timestamp}</span>
      </div>
      <div className="blip-dns-row__sub">
        {sourceApp && <span className="blip-dns-row__app">{sourceApp}</span>}
        {isBlocked && blockedBy && (
          <span className="blip-dns-row__blocked">Blocked by {blockedBy}</span>
        )}
        {!isBlocked && responseIps && responseIps.length > 0 && (
          <span className="blip-dns-row__ips">{responseIps.slice(0, 3).join(', ')}</span>
        )}
      </div>
    </div>
  );
}
