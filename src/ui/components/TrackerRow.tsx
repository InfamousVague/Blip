/**
 * TrackerRow — Icon + domain/category + hits pill + last seen time.
 */

import { Tag } from './Tag';
import type { CSSProperties } from 'react';
import './TrackerRow.css';

interface TrackerRowProps {
  domain: string;
  category?: string;
  totalHits: number;
  lastSeen: string;
  iconUrl?: string;
  className?: string;
  style?: CSSProperties;
}

export function TrackerRow({
  domain,
  category,
  totalHits,
  lastSeen,
  iconUrl,
  className = '',
  style,
}: TrackerRowProps) {
  return (
    <div className={`blip-tracker-row ${className}`} style={style}>
      <div className="blip-tracker-row__left">
        <div className="blip-tracker-row__icon">
          {iconUrl ? (
            <img src={iconUrl} alt="" className="blip-tracker-row__img" />
          ) : (
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
            </svg>
          )}
        </div>
        <div className="blip-tracker-row__info">
          <span className="blip-tracker-row__domain">{domain}</span>
          {category && <span className="blip-tracker-row__category">{category}</span>}
        </div>
      </div>
      <div className="blip-tracker-row__right">
        <Tag>
          {totalHits} <span style={{ fontFamily: 'var(--font-sans)', fontWeight: 400, fontSize: 9, color: 'var(--blip-text-tertiary)' }}>hits</span>
        </Tag>
        <span className="blip-tracker-row__time">{lastSeen}</span>
      </div>
    </div>
  );
}
