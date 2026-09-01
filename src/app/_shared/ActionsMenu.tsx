"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import styles from "./ActionsMenu.module.css";

export interface ActionsMenuItem {
  label: ReactNode;
  onSelect: () => void;
  danger?: boolean;
}

interface MenuPosition {
  top: number;
  right: number;
}

/**
 * The "···" secondary-actions popover — originally Content Studio-only
 * (playlist library cards, the playlist editor header — keeps a card
 * down to one primary action visible instead of a row of equally-
 * weighted buttons, per the product brief's "ne mets pas 15 boutons
 * visibles"), promoted here once `/host`'s own Control Room header
 * needed the identical pattern for the exact same reason: a real,
 * reported UX complaint ("imagine être un streamer... trop surchargé") —
 * that header had accumulated Content Studio / Admin / Forget this
 * session / New code / Copy, all at equal visual weight, all always
 * visible, competing with the one or two things a Host actually needs
 * mid-show. Same fix either way: keep ONE always-visible primary action,
 * fold the rest behind this menu. Closes on outside click, Escape,
 * scroll, or selecting an item.
 *
 * The menu itself is portaled to `document.body` and positioned with
 * `position: fixed`, computed from the trigger's own
 * `getBoundingClientRect()` — NOT `position: absolute` nested inside the
 * card. A `position: absolute` popover is still part of the page's
 * normal scrollable-overflow box even though it doesn't push sibling
 * layout: opened near the bottom of a card grid, its box can extend past
 * whatever the page's current normal-flow bottom edge is, and nothing
 * clips it, so the browser grows the document's scrollable area to fit
 * it — an oversized, ugly scrollbar for as long as the menu is open
 * (reported against exactly this screen). Escaping to a `fixed`-position
 * portal removes the menu from any ancestor's box entirely — it can
 * never affect document scroll height, at any card grid position.
 *
 * `trigger`/`triggerClassName` let a caller swap the default "···" icon
 * button for its own already-styled element (e.g. AccountBadge's pill) —
 * everything else (positioning, outside-click/Escape/scroll close,
 * portal) stays exactly the same either way, so a caller only opts into
 * layout, never re-derives the popover behavior.
 */
export function ActionsMenu({
  items,
  label = "More actions",
  trigger,
  triggerClassName,
}: {
  items: ActionsMenuItem[];
  label?: string;
  trigger?: ReactNode;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      // A real, audited gap: `role="menu"`/`role="menuitem"` below imply
      // the standard ARIA menu keyboard contract (arrow keys move
      // between items), but nothing here actually implemented it — Tab
      // was the only way through. Escape also returns focus to the
      // trigger, same "pick up where you left off" contract Dialog.tsx
      // now follows for the same reason.
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      const count = itemRefs.current.length;
      if (count === 0) return;
      const currentIndex = itemRefs.current.findIndex((el) => el === document.activeElement);
      if (event.key === "ArrowDown") {
        event.preventDefault();
        itemRefs.current[currentIndex === -1 ? 0 : (currentIndex + 1) % count]?.focus();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        itemRefs.current[currentIndex === -1 ? count - 1 : (currentIndex - 1 + count) % count]?.focus();
      } else if (event.key === "Home") {
        event.preventDefault();
        itemRefs.current[0]?.focus();
      } else if (event.key === "End") {
        event.preventDefault();
        itemRefs.current[count - 1]?.focus();
      }
    }
    // Any scroll while open would stale the computed fixed position
    // (it doesn't track the trigger) — closing is simpler and safer
    // than re-measuring on every scroll frame for a short-lived menu.
    function handleScroll() {
      setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [open]);

  // Focus lands on the first item the instant the menu actually opens
  // (its portaled DOM exists by the time this runs, same commit-then-
  // passive-effect ordering Dialog.tsx's own doc comment explains) —
  // opening a menu and having focus stay behind on the trigger, invisible
  // under the popover, was the same class of gap Dialog.tsx just closed.
  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();
  }, [open]);

  function openMenu() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPosition({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
    setOpen(true);
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        ref={triggerRef}
        className={triggerClassName ?? styles.trigger}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={label}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (open) setOpen(false);
          else openMenu();
        }}
      >
        {trigger ?? <span aria-hidden="true">⋯</span>}
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && position && (
              <motion.div
                id={menuId}
                role="menu"
                className={styles.menu}
                style={{ top: position.top, right: position.right }}
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -4 }}
                transition={{ duration: reduced ? 0.1 : 0.14, ease: "easeOut" }}
              >
                {items.map((item, index) => (
                  <button
                    key={index}
                    ref={(el) => {
                      itemRefs.current[index] = el;
                    }}
                    type="button"
                    role="menuitem"
                    className={[styles.item, item.danger && styles.danger].filter(Boolean).join(" ")}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setOpen(false);
                      triggerRef.current?.focus();
                      item.onSelect();
                    }}
                  >
                    {item.label}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
