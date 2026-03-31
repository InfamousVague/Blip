/**
 * PortRow — Server icon + port pill + protocol chip + state chip + kill button.
 * Card-style layout for the ports list.
 */

import { Badge } from './Badge';
import { Chip } from './Chip';
import { Tag } from './Tag';
import type { CSSProperties } from 'react';
import './PortRow.css';

const X_ICON = '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
const SERVER_ICON = '<rect x="2" y="2" width="20" height="8" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2" stroke="currentColor" stroke-width="2" fill="none"/><line x1="6" y1="6" x2="6.01" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="18" x2="6.01" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';

interface PortRowProps {
  port: number;
  processName: string;
  pid: number;
  protocol: string;
  state: string;
  connections?: number;
  onKill?: () => void;
  confirmKill?: boolean;
  className?: string;
  style?: CSSProperties;
}

export function PortRow({
  port,
  processName,
  pid,
  protocol,
  state,
  connections = 0,
  onKill,
  confirmKill = false,
  className = '',
  style,
}: PortRowProps) {
  const isListen = state === 'LISTEN';
  const stateColor = isListen ? 'success' : 'info';
  const protoColor = protocol === 'TCP' ? 'var(--blip-purple-solid)' : 'var(--blip-info)';

  return (
    <div className={`blip-port-row ${className}`} style={style}>
      <div className="blip-port-row__left">
        {/* Server icon */}
        <div className="blip-port-row__icon">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" dangerouslySetInnerHTML={{ __html: SERVER_ICON }} />
        </div>

        {/* Info column */}
        <div className="blip-port-row__info">
          <div className="blip-port-row__name-row">
            <span className="blip-port-row__process">{processName}</span>
            <span className="blip-port-row__pid">PID {pid}</span>
          </div>
          <div className="blip-port-row__chips">
            {/* Port pill */}
            <Badge color="info">:{port}</Badge>
            {/* Protocol */}
            <Chip size="sm" style={{ background: `color-mix(in srgb, ${protoColor} 15%, transparent)`, color: protoColor, fontSize: 10 }}>
              {protocol}
            </Chip>
            {/* State with dot */}
            <Badge color={stateColor} dot>{state}</Badge>
            {/* Connections */}
            {connections > 0 && <Tag>{connections} conn</Tag>}
          </div>
        </div>
      </div>

      {/* Kill button */}
      {onKill && (
        <button
          className={`blip-port-row__kill ${confirmKill ? 'blip-port-row__kill--confirm' : ''}`}
          onClick={onKill}
          aria-label={confirmKill ? 'Confirm kill' : 'Kill process'}
          title={confirmKill ? 'Click again to confirm' : 'Kill process'}
        >
          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" dangerouslySetInnerHTML={{ __html: X_ICON }} />
        </button>
      )}
    </div>
  );
}
