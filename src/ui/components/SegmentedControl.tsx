/**
 * SegmentedControl — Purple active state pills for mode switching.
 */

import type { CSSProperties } from 'react';
import './SegmentedControl.css';

interface Option {
  value: string;
  label: string;
}

interface SegmentedControlProps {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  size?: 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}

export function SegmentedControl({
  options,
  value,
  onChange,
  size = 'md',
  className = '',
  style,
}: SegmentedControlProps) {
  const isSm = size === 'sm';

  return (
    <div className={`blip-segmented ${className}`} role="radiogroup" style={style}>
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            className={`blip-segmented__item ${isActive ? 'blip-segmented__item--active' : ''}`}
            onClick={() => onChange(opt.value)}
            role="radio"
            aria-checked={isActive}
            style={{
              padding: isSm ? '4px 10px' : '6px 16px',
              fontSize: isSm ? '11px' : '13px',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
