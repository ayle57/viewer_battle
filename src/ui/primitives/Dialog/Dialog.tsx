"use client";

import { useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import styles from "./Dialog.module.css";

export type DialogSize = "sm" | "md" | "lg" | "xl";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  size?: DialogSize;
  children: ReactNode;
}

// Every genuinely focusable element a dialog's own content might contain
// — used both to find where to land focus on open and to trap Tab/
// Shift+Tab inside the dialog while it's open. `:not([disabled])` and
// the `[tabindex]` clause follow the same "real interactive elements
// only" posture ActionsMenu.tsx's own roving-focus logic already uses.
const FOCUSABLE_SELECTOR = ['a[href]', 'button:not([disabled])', 'textarea:not([disabled])', 'input:not([disabled])', 'select:not([disabled])', '[tabindex]:not([tabindex="-1"])'].join(
  ",",
);

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => el.offsetParent !== null);
}

/**
 * A real, audited gap this closes: opening a Dialog used to leave
 * keyboard focus wherever it already was — on the button that opened
 * it, still visibly sitting on the page BEHIND this exact overlay — so
 * Tab kept walking the hidden page underneath instead of the dialog a
 * sighted mouse user is looking at. Three parts, the standard WAI-ARIA
 * APG modal-dialog contract: focus moves INTO the dialog the instant it
 * opens (its first real focusable element, or the dialog surface itself
 * if it has none — e.g. a pure informational dialog); Tab/Shift+Tab
 * cycle WITHIN the dialog only, never back out to the page behind it;
 * and focus is handed back to whatever triggered the dialog the moment
 * it closes, so a keyboard user picks up exactly where they left off.
 */
export function Dialog({ open, onClose, title, description, size = "md", children }: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    // Captured once, in a plain closure variable rather than a ref: by
    // the time this effect's cleanup runs (open -> false), the dialog's
    // own DOM has already been unmounted and `document.activeElement`
    // has already snapped back to `<body>` (the browser's own behavior
    // the instant a focused element is removed) — so re-reading either
    // ref at cleanup time would always see "nothing," which is exactly
    // the wrong moment to decide whether to restore focus.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const container = dialogRef.current;
    if (container) {
      const [first] = getFocusable(container);
      (first ?? container).focus();
    }
    return () => previouslyFocused?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const container = dialogRef.current;
      if (!container) return;
      const focusable = getFocusable(container);
      // No focusable content (an unusual, purely informational dialog) —
      // keep focus pinned on the dialog surface itself rather than
      // letting Tab escape to the page behind it.
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      // Non-null: the `length === 0` branch above already returned.
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      const atEdge = event.shiftKey ? active === first || !container.contains(active) : active === last || !container.contains(active);
      if (atEdge) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  function handleOverlayClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === overlayRef.current) onClose();
  }

  return (
    <div className={styles.overlay} ref={overlayRef} onClick={handleOverlayClick}>
      <div
        ref={dialogRef}
        className={[styles.dialog, styles[size]].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <div className={styles.titleBlock}>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {description && (
              <p className={styles.description} id={descriptionId}>
                {description}
              </p>
            )}
          </div>
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="Close dialog">
            ×
          </button>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>
  );
}
