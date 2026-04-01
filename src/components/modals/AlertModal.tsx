/**
 * AlertModal — Centered feedback dialog for error, success, and info states.
 */

import { Modal } from '../../ui/components/Modal';
import { Button } from '../../ui/components/Button';
import './AlertModal.css';

type AlertVariant = 'error' | 'success' | 'info';

const VARIANT_CONFIG: Record<AlertVariant, { className: string; defaultAction: string }> = {
  error: { className: 'alert-modal--error', defaultAction: 'Dismiss' },
  success: { className: 'alert-modal--success', defaultAction: 'Done' },
  info: { className: 'alert-modal--info', defaultAction: 'OK' },
};

interface AlertModalProps {
  open: boolean;
  onClose: () => void;
  variant: AlertVariant;
  title: string;
  description: string;
  /** Optional code or detail string shown in a code box (e.g. error codes). */
  detail?: string;
  /** Primary action button label. Defaults per variant. */
  actionLabel?: string;
  /** Optional secondary action (e.g. "Open Settings"). */
  secondaryLabel?: string;
  onSecondaryAction?: () => void;
}

export function AlertModal({
  open,
  onClose,
  variant,
  title,
  description,
  detail,
  actionLabel,
  secondaryLabel,
  onSecondaryAction,
}: AlertModalProps) {
  const config = VARIANT_CONFIG[variant];
  const primaryLabel = actionLabel ?? config.defaultAction;

  return (
    <Modal open={open} onClose={onClose} width={400} className={config.className}>
      <div className={`alert-modal__icon alert-modal__icon--${variant}`} />

      <div className="alert-modal__text">
        <h3 className="alert-modal__title">{title}</h3>
        <p className="alert-modal__desc">{description}</p>
      </div>

      {detail && (
        <div className={`alert-modal__detail alert-modal__detail--${variant}`}>
          <code>{detail}</code>
        </div>
      )}

      <div className="alert-modal__buttons">
        {secondaryLabel && onSecondaryAction ? (
          <>
            <Button variant="ghost" size="sm" onClick={onClose}>
              {primaryLabel}
            </Button>
            <button
              className={`alert-modal__action alert-modal__action--${variant}`}
              onClick={() => { onSecondaryAction(); onClose(); }}
            >
              {secondaryLabel}
            </button>
          </>
        ) : (
          <Button variant="ghost" size="sm" onClick={onClose}>
            {primaryLabel}
          </Button>
        )}
      </div>
    </Modal>
  );
}
