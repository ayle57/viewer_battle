"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { popIn } from "@/app/_shared/motion/variants";
import { Badge, Button, ClickableImageMap, Dialog, type MapMarker } from "@/ui";
import styles from "./RoundPreview.module.css";

export interface RoundPreviewRound {
  title: string | null;
  question: string | null;
  imageUrl: string | null;
  targetX: number | null;
  targetY: number | null;
}

export interface RoundPreviewProps {
  round: RoundPreviewRound;
  roundNumber: number;
  onClose: () => void;
}

/**
 * Item 11's "real preview, not a mock" — reuses the actual
 * `ClickableImageMap` primitive Player/Host/Display all render through,
 * over this round's real, already-saved data. Deliberately NOT a live
 * `GeoGuessrState`: building one would mean fabricating a fake game
 * (fake teams, fake phase, fake locks) just to satisfy this dialog,
 * which is exactly the kind of mock-state shortcut this pass rules out —
 * a Content Studio preview has no real session/game behind it and never
 * should. `revealed` is local-only UI state, entirely separate from the
 * real Game Kernel's `phase: "revealed"` (src/domain/game/geoGuessr) —
 * this toggle can't and doesn't touch any running game, it only decides
 * whether THIS dialog currently draws the target marker.
 *
 * Defaults to hidden on every open (`useState(false)`, no persistence)
 * on purpose — the whole point of a "does this feel right on stream"
 * check is seeing what the audience sees FIRST, same as a real round.
 */
export function RoundPreview({ round, roundNumber, onClose }: RoundPreviewProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const [revealed, setRevealed] = useState(false);
  const hasTarget = round.targetX !== null && round.targetY !== null;
  const markers: MapMarker[] =
    revealed && hasTarget ? [{ id: "target", x: round.targetX!, y: round.targetY!, color: "target", label: "TARGET" }] : [];

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Preview — Round ${roundNumber}`}
      description="What Display shows during this round, before either team has locked."
      size="xl"
    >
      <div className={styles.stage}>
        <p className={styles.roundLabel}>ROUND {roundNumber}</p>
        {round.question ? <p className={styles.question}>{round.question}</p> : <p className={styles.questionMissing}>No question set yet</p>}
        <ClickableImageMap imageUrl={round.imageUrl ?? ""} alt={round.title || "Round map"} markers={markers} empty={!round.imageUrl} />
        <div className={styles.footer}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span key={revealed ? "revealed" : "hidden"} variants={popIn(reduced, { scale: 0.85 })} initial="hidden" animate="show" style={{ display: "inline-flex" }}>
              <Badge variant={revealed ? "success" : "neutral"} dot>
                {revealed ? "Answer revealed (preview only)" : "Answer hidden"}
              </Badge>
            </motion.span>
          </AnimatePresence>
          <Button variant="secondary" size="sm" disabled={!hasTarget} onClick={() => setRevealed((r) => !r)}>
            {revealed ? "Hide answer" : "Reveal answer"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
