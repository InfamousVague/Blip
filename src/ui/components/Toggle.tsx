/**
 * Toggle — Purple on/off switch.
 */

import type { CSSProperties } from 'react';
import './Toggle.css';

interface ToggleProps {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function Toggle({
  checked = false,
  onChange,
  size = 'md',
  disabled = false,
  label,
  className = '',
  style,
}: ToggleProps) {
  return (
    <label
      className={`blip-toggle blip-toggle--${size} ${checked ? 'blip-toggle--on' : ''} ${disabled ? 'blip-toggle--disabled' : ''} ${className}`}
      style={style}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange?.(e.target.checked)}
        disabled={disabled}
        className="blip-toggle__input"
      />
      <span className="blip-toggle__track">
        <span className="blip-toggle__knob" />
      </span>
      {label && <span className="blip-toggle__label">{label}</span>}
    </label>
  );
}
