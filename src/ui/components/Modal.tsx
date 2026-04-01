/**
 * Modal — Reusable glass-styled modal dialog.
 * Supports two variants:
 *   "default" — dark backdrop with blur (for alerts, confirms)
 *   "glass"   — transparent backdrop, sidebar-matching frosted shell (for settings-style modals)
 */

import type { CSSProperties, ReactNode, MouseEventHandler } from 'react';
import './Modal.css';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Width of the dialog shell. Default: 440 */
  width?: number;
  /** "default" = dark backdrop blur, "glass" = transparent backdrop with sidebar glass shell */
  variant?: 'default' | 'glass';
  className?: string;
  style?: CSSProperties;
}

export function Modal({
  open,
  onClose,
  children,
  width = 440,
  variant = 'default',
  className = '',
  style,
}: ModalProps) {
  if (!open) return null;

  const handleBackdropClick: MouseEventHandler = (e) => {
    if (e.target === e.currentTarget) onClose();
  };

  const backdropClass = variant === 'glass'
    ? 'blip-modal-backdrop blip-modal-backdrop--glass'
    : 'blip-modal-backdrop';

  const shellClass = variant === 'glass'
    ? `blip-modal-shell blip-modal-shell--glass ${className}`
    : `blip-modal-shell ${className}`;

  return (
    <div className={backdropClass} onClick={handleBackdropClick}>
      <div
        className={shellClass}
        style={{ maxWidth: width, ...style }}
      >
        {children}
      </div>
    </div>
  );
}
