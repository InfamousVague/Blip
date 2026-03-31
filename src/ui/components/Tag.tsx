/**
 * Tag — Compact count label (e.g., "142" next to a process name).
 */

import type { CSSProperties, ReactNode } from 'react';

interface TagProps {
  children?: ReactNode;
  color?: 'neutral' | 'accent';
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}

export function Tag({
  children,
  color = 'neutral',
  size = 'sm',
  className = '',
  style,
}: TagProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: size === 'sm' ? '1px 5px' : '2px 6px',
        borderRadius: '4px',
        fontSize: size === 'sm' ? '10px' : '11px',
        fontFamily: 'var(--font-mono)',
        fontWeight: 500,
        lineHeight: 1.3,
        color: 'var(--blip-text-tertiary)',
        background: color === 'accent' ? 'var(--blip-purple-muted)' : 'var(--blip-purple-subtle)',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
