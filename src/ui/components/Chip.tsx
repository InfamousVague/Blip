/**
 * Chip — Purple outlined pill for categorization.
 */

import type { CSSProperties, ReactNode } from 'react';

interface ChipProps {
  children?: ReactNode;
  variant?: 'filled' | 'outlined';
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}

export function Chip({
  children,
  variant = 'filled',
  size = 'sm',
  className = '',
  style,
}: ChipProps) {
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: size === 'sm' ? '3px 8px' : '4px 10px',
        borderRadius: '9999px',
        fontSize: size === 'sm' ? '11px' : '12px',
        fontFamily: 'var(--font-sans)',
        fontWeight: 500,
        lineHeight: 1.3,
        color: variant === 'outlined' ? 'var(--blip-purple-text)' : 'var(--blip-text-primary)',
        background: 'var(--blip-purple-subtle)',
        border: variant === 'outlined' ? '1px solid rgba(255, 255, 255, 0.06)' : 'none',
        ...style,
      }}
    >
      {children}
    </span>
  );
}
