/**
 * ServiceRow — Service list item with icon, name/domain, upload/download badges.
 * Badges use NumberRoll with dimmed leading zeros for consistent width.
 */

import { Badge } from './Badge';
import { NumberRoll } from '@mattmattmattmatt/base/primitives/number-roll/NumberRoll';
import '@mattmattmattmatt/base/primitives/number-roll/number-roll.css';
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
  onClick?: () => void;
}

/** Split bytes into { whole, decimal, unit } for NumberRoll rendering */
function splitBytes(bytes: number): { whole: number; decimal: number; unit: string } {
  if (bytes === 0) return { whole: 0, decimal: 0, unit: 'B' };
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  const val = bytes / k ** i;
  const unit = sizes[Math.min(i, sizes.length - 1)];
  return { whole: Math.floor(val), decimal: Math.floor((val % 1) * 10), unit };
}

function ByteValue({ bytes }: { bytes: number }) {
  if (bytes === 0) return <>{'—'}</>;
  const { whole, decimal, unit } = splitBytes(bytes);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.05em' }}>
      <NumberRoll value={whole} minDigits={3} duration={300} dimLeadingZeros />
      <span style={{ opacity: 0.5 }}>.</span>
      <NumberRoll value={decimal} minDigits={1} duration={300} dimLeadingZeros={false} />
      <span style={{ marginLeft: '0.2em' }}>{unit}</span>
    </span>
  );
}

export function ServiceRow({
  name,
  domain,
  iconUrl,
  bytesSent,
  bytesReceived,
  className = '',
  style,
  onClick,
}: ServiceRowProps) {
  return (
    <div className={`blip-service-row ${className}`} style={style} onClick={onClick} role={onClick ? "button" : undefined}>
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
          <ByteValue bytes={bytesSent} />
        </Badge>
        <Badge color="download" icon={ARROW_DOWN}>
          <ByteValue bytes={bytesReceived} />
        </Badge>
      </div>
    </div>
  );
}
