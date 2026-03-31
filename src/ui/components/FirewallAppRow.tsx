/**
 * FirewallAppRow — App icon + name + upload/download badges + tri-state toggle.
 * Used in the firewall app list.
 */

import { Badge } from './Badge';
import { TriStateToggle, type TriStateValue } from './TriStateToggle';
import type { CSSProperties, ReactNode } from 'react';
import './FirewallAppRow.css';

const ARROW_UP = '<path d="M12 19V5M12 5l-5 5M12 5l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const ARROW_DOWN = '<path d="M12 5v14M12 19l-5-5M12 19l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

interface FirewallAppRowProps {
  name: string;
  iconUrl?: string;
  bytesSent: number;
  bytesReceived: number;
  action: TriStateValue;
  onSetAction: (action: TriStateValue) => void;
  onClick?: () => void;
  expanded?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '—';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return `${(bytes / k ** i).toFixed(1)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

export function FirewallAppRow({
  name,
  iconUrl,
  bytesSent,
  bytesReceived,
  action,
  onSetAction,
  onClick,
  expanded = false,
  children,
  className = '',
  style,
}: FirewallAppRowProps) {
  return (
    <div className={`blip-fw-row ${expanded ? 'blip-fw-row--expanded' : ''} ${className}`} style={style}>
      <div className="blip-fw-row__main" onClick={onClick}>
        <div className="blip-fw-row__left">
          <div className="blip-fw-row__icon">
            {iconUrl ? (
              <img src={iconUrl} alt="" className="blip-fw-row__img" />
            ) : (
              <span className="blip-fw-row__placeholder">{name.charAt(0)}</span>
            )}
          </div>
          <div className="blip-fw-row__info">
            <span className="blip-fw-row__name">{name}</span>
            <div className="blip-fw-row__badges">
              <Badge color="upload" icon={ARROW_UP}>{formatBytes(bytesSent)}</Badge>
              <Badge color="download" icon={ARROW_DOWN}>{formatBytes(bytesReceived)}</Badge>
            </div>
          </div>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <TriStateToggle value={action} onChange={onSetAction} />
        </div>
      </div>
      {expanded && children && (
        <div className="blip-fw-row__detail">{children}</div>
      )}
    </div>
  );
}
