/**
 * Badge — Functional color pill for data display.
 * Colored background (32% opacity) with matching colored text.
 */

import type { CSSProperties, ReactNode } from 'react';
import './Badge.css';

type BadgeColor = 'download' | 'upload' | 'success' | 'error' | 'warning' | 'info' | 'neutral';

interface BadgeProps {
  children?: ReactNode;
  color?: BadgeColor;
  variant?: 'solid' | 'subtle';
  size?: 'sm' | 'md';
  icon?: string;
  className?: string;
  style?: CSSProperties;
  dot?: boolean;
}

const COLOR_MAP: Record<BadgeColor, { text: string; bg: string }> = {
  download: { text: 'var(--blip-download)', bg: 'var(--blip-download-bg)' },
  upload: { text: 'var(--blip-upload)', bg: 'var(--blip-upload-bg)' },
  success: { text: 'var(--blip-success)', bg: 'var(--blip-success-bg)' },
  error: { text: 'var(--blip-error)', bg: 'var(--blip-error-bg)' },
  warning: { text: 'var(--blip-warning)', bg: 'var(--blip-warning-bg)' },
  info: { text: 'var(--blip-info)', bg: 'var(--blip-info-bg)' },
  neutral: { text: 'var(--blip-text-secondary)', bg: 'var(--blip-purple-subtle)' },
};

export function Badge({
  children,
  color = 'neutral',
  variant = 'subtle',
  size = 'sm',
  icon,
  className = '',
  style,
  dot = false,
}: BadgeProps) {
  const colors = COLOR_MAP[color];
  const isSm = size === 'sm';

  return (
    <span
      className={`blip-badge blip-badge--${variant} ${className}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: dot ? '4px' : '2px',
        padding: isSm ? '1px 6px' : '2px 8px',
        borderRadius: '9999px',
        fontSize: isSm ? '10px' : '11px',
        fontFamily: 'var(--font-mono)',
        fontWeight: 500,
        lineHeight: 1.3,
        color: colors.text,
        background: variant === 'solid' ? colors.text : colors.bg,
        ...(variant === 'solid' ? { color: '#fff' } : {}),
        ...style,
      }}
    >
      {dot && (
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: '50%',
            background: colors.text,
            flexShrink: 0,
          }}
        />
      )}
      {icon && (
        <span
          className="blip-badge__icon"
          style={{ display: 'flex', alignItems: 'center' }}
          dangerouslySetInnerHTML={{
            __html: `<svg viewBox="0 0 24 24" width="${isSm ? 8 : 10}" height="${isSm ? 8 : 10}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>`,
          }}
        />
      )}
      {children}
    </span>
  );
}
