/**
 * FrostedCard — Inner frosted glass card for sidebar sections.
 * Semi-transparent white fill + backdrop blur + subtle border.
 * Used inside clear glass panels (GlassPanel) for the layered glass look.
 */

import type { CSSProperties, ReactNode } from 'react';
import './glass.css';

interface FrostedCardProps {
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Padding inside the card. Default: 14px */
  padding?: number;
  /** Gap between children. Default: 0 */
  gap?: number;
  /** Corner radius. Default: 14 */
  borderRadius?: number;
  /** Whether to show the card as collapsible (with header + chevron) */
  collapsible?: boolean;
  /** Title for collapsible header */
  title?: string;
  /** Click handler for collapsible header */
  onToggle?: () => void;
  /** Whether collapsible is open */
  open?: boolean;
}

export function FrostedCard({
  children,
  className = '',
  style,
  padding = 14,
  gap = 0,
  borderRadius = 14,
}: FrostedCardProps) {
  return (
    <div
      className={`frosted-card ${className}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap,
        padding,
        borderRadius,
        background: 'var(--glass-card-fill)',
        border: '1px solid var(--glass-card-border)',
        backdropFilter: 'blur(var(--glass-card-blur))',
        WebkitBackdropFilter: 'blur(var(--glass-card-blur))',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
