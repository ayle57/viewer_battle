"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import type { DrawingState } from "@/domain/game/drawing";
import { useDrawingStore } from "@/app/_shared/drawingStore";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { Card, CardBody } from "@/ui";
import { CountdownBadge } from "@/app/_shared/CountdownBadge";
import { DrawingCanvas } from "./DrawingCanvas";
import styles from "./DisplayDrawingPanel.module.css";

export interface DisplayDrawingPanelProps {
  state: DrawingState;
  requestDrawingSnapshot: () => Promise<{ strokes: { points: { x: number; y: number }[]; color: string; width: number }[] }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

/**
 * Read-only, OBS-scale — no `sendAction`/`sendStroke` anywhere in this
 * component, same "no path to game:action" guarantee DisplayGeoPanel/
 * DisplayBoardPanel already have. Never sees a live stroke or the secret
 * word while `phase === "drawing"` — `requestDrawingSnapshot` genuinely
 * only ever returns real strokes here once the round leaves "drawing"
 * (drawing.ts's own `mayViewLiveStrokes`), so there's nothing in this
 * component that could leak either even by accident.
 *
 * `DrawingPhase` is `"choosing_drawer" | "drawing" | "guessing" |
 * "resolved"` — the canvas itself only ever shows real content once the
 * turn leaves `"drawing"` (`"guessing"` or `"resolved"` — the round's
 * over, strokes are the whole point now, and stay on screen through the
 * Host's own judged-outcome pause too, not just the guessing beat); the
 * other two phases both render the SAME hidden placeholder, just with
 * different copy (`choosingDrawer` below picks between them) — see
 * `revealed`'s own doc comment for the real bug this distinction fixes.
 */
export function DisplayDrawingPanel({ state, requestDrawingSnapshot }: DisplayDrawingPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const strokes = useDrawingStore((s) => s.strokes);
  const setSnapshot = useDrawingStore((s) => s.setSnapshot);

  useEffect(() => {
    void requestDrawingSnapshot().then(({ strokes: fresh }) => setSnapshot(fresh));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.currentPromptIndex]);

  // A REAL, REPRODUCED bug this fixes: `state.phase !== "drawing"` treats
  // "choosing_drawer" as "revealed" too (DrawingPhase is only ever
  // "choosing_drawer" | "drawing" | "guessing" | "resolved" — this file's
  // own doc comment already knew that, the condition just didn't match
  // it). The moment a judged guess starts the NEXT turn, that turn's own
  // "choosing_drawer" briefly rendered the real (but still genuinely
  // empty) `<DrawingCanvas>` instead of the hidden placeholder — a blank,
  // unlabeled black rectangle on stream with zero context, easy to
  // mistake for something actually broken. `revealed` now means "the
  // round has left the drawing phase" — both "guessing" AND the Host's
  // own judged-outcome pause ("resolved") show the real strokes; only
  // "choosing_drawer"/"drawing" ever hide them.
  const revealed = state.phase === "guessing" || state.phase === "resolved";
  const choosingDrawer = state.phase === "choosing_drawer";

  // The judged/skipped outcome, for the one beat OBS actually needs it —
  // same `history`-last-entry read as HostDrawingPanel's own
  // `lastTurnOutcome`, just plainer copy (no team-colored headline card
  // here, this screen has no "next" button to pace with either way).
  const lastTurn = state.phase === "resolved" ? state.history[state.history.length - 1] : undefined;
  const resolvedLabel =
    lastTurn === undefined
      ? null
      : lastTurn.correct === null
        ? "Turn skipped — no point"
        : lastTurn.correct
          ? `${TEAM_LABEL[lastTurn.team]} GOT IT!`
          : `WRONG — POINT TO ${TEAM_LABEL[lastTurn.team === "TEAM_A" ? "TEAM_B" : "TEAM_A"]}`;

  return (
    <motion.div className={styles.wrap} initial="hidden" animate="show" variants={fadeUp(reduced)}>
      <Card variant="raised" className={styles.scoreCard}>
        <CardBody>
          <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} size="lg" />
        </CardBody>
      </Card>

      <CountdownBadge deadlineMs={state.countdownDeadline} label="Turn ends in" className={styles.countdownBadge} />

      <motion.div key={state.currentPromptIndex} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 14, duration: 0.4 })}>
        <p className={styles.turnLabel}>{TEAM_LABEL[state.activeTeam]}&apos;S TURN</p>
        {state.phase === "drawing" && <p className={styles.waitingLabel}>Drawing in progress…</p>}
        {resolvedLabel && <p className={styles.waitingLabel}>{resolvedLabel}</p>}
      </motion.div>

      <Card className={styles.canvasCard}>
        <CardBody>
          {/* A real reveal MOMENT, not a silent Card swap — the canvas
              pops in the instant the round leaves "drawing," the same
              "arrival" language this game's own reveal beats already
              use (PlayerDrawingPanel's word/time's-up cards). */}
          <AnimatePresence mode="wait">
            {revealed ? (
              <motion.div key="revealed" initial="hidden" animate="show" variants={popIn(reduced)}>
                <DrawingCanvas strokes={strokes} readOnly />
              </motion.div>
            ) : (
              <motion.div key="hidden" className={styles.hiddenCanvas} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <span className={styles.hiddenIcon} aria-hidden="true">
                  🎨
                </span>
                <p>{choosingDrawer ? `Waiting for ${TEAM_LABEL[state.activeTeam]} to pick a drawer…` : "The canvas reveals once the timer runs out."}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </CardBody>
      </Card>
    </motion.div>
  );
}
