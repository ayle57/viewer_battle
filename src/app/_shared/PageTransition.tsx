"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";

/**
 * The real fix for "there are no page transitions": the native browser
 * View Transitions API (the `<meta name="view-transition">` tag in
 * layout.tsx, still there) only fires on a genuine cross-document
 * navigation — a full page unload/reload. `next/link` deliberately never
 * does that; it intercepts the click and does a client-side route swap
 * (no document unload) precisely so navigation stays fast, which means
 * the native API silently never engages no matter what CSS backs it.
 * This wraps the App Router's actual per-route re-render in Framer
 * Motion instead — `usePathname()` changing is a REAL fact (an actual
 * navigation happened), keyed on `AnimatePresence` so the outgoing route
 * slides out left while the incoming one slides in from the right, the
 * same directional language the (still-present, still-harmless) native
 * transition CSS uses for the rare case a real cross-document nav
 * happens (typing a URL, a hard refresh).
 *
 * Every route already fully unmounts/remounts on navigation regardless
 * (different page component) — this only adds a controlled exit/enter
 * around that, never changes what mounts or when a socket connects.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // Hydration-safe on purpose — see useReducedMotionSafe.ts's doc
  // comment for the real, confirmed mismatch a raw `useReducedMotion()`
  // caused here (branching between two entirely different tree shapes).
  const reduced = useReducedMotionSafe();

  if (reduced) return <>{children}</>;

  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={pathname}
        initial={{ opacity: 0, x: 32 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -32 }}
        transition={{ duration: 0.36, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
