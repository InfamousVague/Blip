/**
 * Button — Glass-styled button with primary/secondary/ghost variants.
 */

import type { CSSProperties, ReactNode, MouseEventHandler } from 'react';
import './Button.css';

interface ButtonProps {
  children?: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  iconOnly?: boolean;
  onClick?: MouseEventHandler;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  'aria-label'?: string;
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  iconOnly = false,
  onClick,
  disabled = false,
  className = '',
  style,
  ...rest
}: ButtonProps) {
  const classes = [
    'blip-btn',
    `blip-btn--${variant}`,
    `blip-btn--${size}`,
    iconOnly ? 'blip-btn--icon-only' : '',
    disabled ? 'blip-btn--disabled' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <button
      className={classes}
      onClick={onClick}
      disabled={disabled}
      style={style}
      {...rest}
    >
      {icon && (
        <span
          className="blip-btn__icon"
          dangerouslySetInnerHTML={{ __html: `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">${icon}</svg>` }}
        />
      )}
      {!iconOnly && children}
    </button>
  );
}
