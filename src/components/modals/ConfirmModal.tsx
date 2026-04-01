/**
 * ConfirmModal — Generic confirmation dialog for destructive or important actions.
 */

import { Modal } from '../../ui/components/Modal';
import { Button } from '../../ui/components/Button';
import './ConfirmModal.css';

interface ConfirmModalProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'destructive' | 'default';
}

export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
}: ConfirmModalProps) {
  const isDestructive = variant === 'destructive';

  return (
    <Modal open={open} onClose={onClose} width={400}>
      <div className="confirm-modal__content">
        <div className="confirm-modal__title-row">
          <span className={`confirm-modal__icon ${isDestructive ? 'confirm-modal__icon--destructive' : 'confirm-modal__icon--default'}`} />
          <h3 className="confirm-modal__title">{title}</h3>
        </div>
        <p className="confirm-modal__desc">{description}</p>
      </div>

      <div className="confirm-modal__buttons">
        <Button variant="ghost" size="sm" onClick={onClose}>{cancelLabel}</Button>
        <button
          className={`confirm-modal__action ${isDestructive ? 'confirm-modal__action--destructive' : 'confirm-modal__action--default'}`}
          onClick={() => { onConfirm(); onClose(); }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
