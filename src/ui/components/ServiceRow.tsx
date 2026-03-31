/**
 * ServiceRow — Service list item with icon, name/domain, upload/download badges.
 */

import { Badge } from './Badge';
import type { CSSProperties } from 'react';
import './ServiceRow.css';

const ARROW_UP = '<path d="M12 19V5M12 5l-5 5M12 5l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const ARROW_DOWN = '<path d="M12 5v14M12 19l-5-5M12 19l5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';

interface ServiceRowProps {
  name: string;
  domain?: string;
  iconUrl?: string;
  bytesSent: number;
  bytesReceived: number;
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

export function ServiceRow({
  name,
  domain,
  iconUrl,
  bytesSent,
  bytesReceived,
  className = '',
  style,
}: ServiceRowProps) {
  return (
    <div className={`blip-service-row ${className}`} style={style}>
      <div className="blip-service-row__left">
        <div className="blip-service-row__icon">
          {iconUrl ? (
            <img src={iconUrl} alt="" className="blip-service-row__img" />
          ) : (
            <span className="blip-service-row__placeholder">{name.charAt(0)}</span>
          )}
        </div>
        <div className="blip-service-row__info">
          <span className="blip-service-row__name">{name}</span>
          {domain && <span className="blip-service-row__domain">{domain}</span>}
        </div>
      </div>
      <div className="blip-service-row__badges">
        <Badge color="upload" icon={ARROW_UP}>
          {formatBytes(bytesSent)}
        </Badge>
        <Badge color="download" icon={ARROW_DOWN}>
          {formatBytes(bytesReceived)}
        </Badge>
      </div>
    </div>
  );
}
