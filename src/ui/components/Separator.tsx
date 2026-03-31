/**
 * Separator — Glass-aware divider line.
 */

import type { CSSProperties } from 'react';

interface SeparatorProps {
  className?: string;
  style?: CSSProperties;
}

export function Separator({ className = '', style }: SeparatorProps) {
  return (
    <div
      className={className}
      role="separator"
      style={{
        height: 1,
        background: 'var(--blip-border-default)',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
