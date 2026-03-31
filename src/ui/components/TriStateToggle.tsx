/**
 * TriStateToggle — Squircle segmented control with check/minus/x icons.
 * Used in firewall for allow/unspecified/deny states.
 */

import type { CSSProperties } from 'react';
import './TriStateToggle.css';

export type TriStateValue = 'allow' | 'unspecified' | 'deny';

interface TriStateToggleProps {
  value: TriStateValue;
  onChange: (value: TriStateValue) => void;
  size?: 'sm' | 'md';
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
}

const STATES: { value: TriStateValue; icon: string; color: string; activeBg: string }[] = [
  {
    value: 'allow',
    icon: '<path d="M5 12l5 5L20 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    color: 'var(--blip-success)',
    activeBg: 'rgba(34, 197, 94, 0.45)',
  },
  {
    value: 'unspecified',
    icon: '<path d="M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>',
    color: 'rgba(120, 120, 130, 1)',
    activeBg: 'rgba(255, 255, 255, 0.12)',
  },
  {
    value: 'deny',
    icon: '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>',
    color: 'var(--blip-error)',
    activeBg: 'rgba(239, 68, 68, 0.45)',
  },
];

export function TriStateToggle({
  value,
  onChange,
  size = 'md',
  disabled = false,
  className = '',
  style,
}: TriStateToggleProps) {
  const isSm = size === 'sm';

  return (
    <div
      className={`blip-tristate ${disabled ? 'blip-tristate--disabled' : ''} ${className}`}
      role="radiogroup"
      aria-label="Connection rule"
      style={style}
    >
      {STATES.map((state) => {
        const isActive = value === state.value;
        return (
          <button
            key={state.value}
            className={`blip-tristate__btn ${isActive ? 'blip-tristate__btn--active' : ''}`}
            onClick={() => !disabled && onChange(state.value)}
            disabled={disabled}
            role="radio"
            aria-checked={isActive}
            aria-label={state.value}
            title={state.value.charAt(0).toUpperCase() + state.value.slice(1)}
            style={{
              padding: isSm ? '4px 8px' : '6px 10px',
              background: isActive ? state.activeBg : 'transparent',
              color: isActive ? state.color : 'rgba(255, 255, 255, 0.35)',
            }}
          >
            <svg
              viewBox="0 0 24 24"
              width={isSm ? 12 : 14}
              height={isSm ? 12 : 14}
              fill="none"
              dangerouslySetInnerHTML={{ __html: state.icon }}
            />
          </button>
        );
      })}
    </div>
  );
}
