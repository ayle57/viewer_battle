"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import styles from "./ActionsMenu.module.css";

export interface ActionsMenuItem {
  label: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

/**
 * The "···" secondary-actions popover for Content Studio's cards
 * (playlist library cards, the playlist editor header) — keeps a card
 * down to one primary action visible (EDIT) instead of a row of equally-
 * weighted buttons, per the product brief's "ne mets pas 15 boutons
 * visibles." Closes on outside click, Escape, or selecting an item.
 * Genuinely new UI chrome, not a business feature — scoped to Content
 * Studio rather than promoted into src/ui, since this pass is Content
 * Studio only.
 */
export function ActionsMenu({ items, label = "More actions" }: { items: ActionsMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const reduced = useReducedMotion() ?? false;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            className={styles.menu}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -4 }}
            transition={{ duration: reduced ? 0.1 : 0.14, ease: "easeOut" }}
          >
            {items.map((item, index) => (
              <button
                key={index}
                type="button"
                role="menuitem"
                className={[styles.item, item.danger && styles.danger].filter(Boolean).join(" ")}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
