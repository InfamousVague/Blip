/**
 * ProcessRow — Simple name + count tag for top processes list.
 */

import { Tag } from './Tag';
import type { CSSProperties } from 'react';

interface ProcessRowProps {
  name: string;
  count: number;
  className?: string;
  style?: CSSProperties;
}

export function ProcessRow({ name, count, className = '', style }: ProcessRowProps) {
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
        {name}
      </span>
      <Tag>{String(count)}</Tag>
    </div>
  );
}
