"use client";

import type { ReactNode } from "react";
import { Button } from "../Button/Button";
import { Dialog, type DialogSize } from "../Dialog/Dialog";
import styles from "./ConfirmDialog.module.css";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button (Button's `danger` variant) for an irreversible-feeling or state-changing action; false for a plain confirmation. */
  danger?: boolean;
  /** Disables both buttons and shows a spinner on Confirm — while the action itself is a real pending mutation, not this dialog's own state. */
  confirming?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}

/**
 * A generic yes/no confirmation on top of Dialog — built once here so
 * "are you sure" moments across the app (Forget this session today,
 * whatever needs one later) share the same shape, copy rhythm, and
 * danger-button convention instead of each screen rolling its own.
 * Owns no business logic: `onConfirm` is whatever the caller actually
 * wants to happen, this component only renders the question and the two
 * buttons.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  confirming = false,
  onCancel,
  onConfirm,
  children,
  size = "sm",
}: ConfirmDialogProps & { size?: DialogSize }) {
  const titleContent = danger ? (
    <span className={styles.dangerTitle}>
      <span className={styles.dangerIcon} aria-hidden="true">
        !
      </span>
      {title}
    </span>
  ) : (
    title
  );

  return (
    <Dialog open={open} onClose={onCancel} title={titleContent} description={description} size={size}>
      {children}
      <div className={styles.actions}>
        <Button variant="ghost" onClick={onCancel} disabled={confirming}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? "danger" : "primary"} onClick={onConfirm} loading={confirming}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
