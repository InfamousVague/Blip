/**
 * DestinationRow — Country + count tag for top destinations list.
 */

import { Tag } from './Tag';
import type { CSSProperties } from 'react';

interface DestinationRowProps {
  country: string;
  count: number;
  className?: string;
  style?: CSSProperties;
}

export function DestinationRow({ country, count, className = '', style }: DestinationRowProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '3px 0',
        ...style,
      }}
    >
      <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--blip-text-primary)' }}>
        {country}
      </span>
      <Tag>{String(count)}</Tag>
    </div>
  );
}
