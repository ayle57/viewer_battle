"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import type { DrawingState } from "@/domain/game/drawing";
import { useDrawingStore } from "@/app/_shared/drawingStore";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { Button } from "@/ui";
import { useCountdownRemaining } from "@/app/_shared/useCountdownRemaining";
import { formatCountdown } from "@/app/_shared/formatCountdown";
import { readableDrawingError } from "./drawingErrorMessages";
import { DrawingCanvas } from "./DrawingCanvas";
import { PEN_COLORS, PEN_WIDTHS } from "./penOptions";
import styles from "./PlayerDrawingPanel.module.css";

export interface PlayerDrawingPanelProps {
  state: DrawingState;
  role: "TEAM_A" | "TEAM_B";
  /** This viewer's OWN display name — same convention as PlayerGeoPanel's identical prop (GeoProposal's byName): used only to tell whether THIS specific teammate is the chosen drawer, never sent anywhere new, never trusted for anything server-authoritative (the server re-derives the same fact from the socket's own identity). */
  displayName: string;
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
  sendStroke: (stroke: { points: { x: number; y: number }[]; color: string; width: number }) => Promise<{ ok: boolean; error?: string }>;
  sendDrawingClear: () => Promise<{ ok: boolean; error?: string }>;
  /** Drops just the most recent stroke — src/server/sockets/drawing.ts's own `drawing:undo` doc comment. A real, audited gap: "Clear" used to be the ONLY way to correct a slipped tap on a touch canvas, wiping the whole drawing under a running timer. */
  sendDrawingUndo: () => Promise<{ ok: boolean; error?: string }>;
  requestDrawingSnapshot: () => Promise<{ strokes: { points: { x: number; y: number }[]; color: string; width: number }[] }>;
  requestDrawingPrompt: () => Promise<{ text: string | null }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };
/** Below this many ms remaining, the drawer's own big countdown escalates from calm to urgent — a real UX signal (matches the same "last few seconds should feel different" instinct as every other countdown in this app), not just decoration. */
const URGENT_THRESHOLD_MS = 10_000;

/**
 * The player's Drawing UI — "who draws" -> drawing (drawer sees the
 * canvas + secret word, the teammate sees a live read-only view with no
 * word) -> "guessing" (word still hidden here — a guess is spoken out
 * loud/in chat, never typed, per the product's own stated flow) ->
 * repeat for the other team.
 *
 * This component owns NO game rules — `state.phase`/`drawerName`/
 * `activeTeam`/`countdownDeadline` are the only things that decide what
 * renders; every actual transition is a real `game:action` the server
 * either accepts or rejects. The canvas itself is a genuinely separate,
 * ephemeral concern (`useDrawingStore`/`sendStroke`/`requestDrawingSnapshot`)
 * — see src/server/sockets/drawing.ts's own top comment: this panel never
 * decides whether a stroke is allowed, it only reflects what the server
 * already accepted or refused.
 */
export function PlayerDrawingPanel({
  state,
  role,
  displayName,
  sendAction,
  sendStroke,
  sendDrawingClear,
  sendDrawingUndo,
  requestDrawingSnapshot,
  requestDrawingPrompt,
}: PlayerDrawingPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [syncedPhase, setSyncedPhase] = useState(state.phase);
  const [promptText, setPromptText] = useState<string | null>(null);
  const [penColor, setPenColor] = useState<string>(PEN_COLORS[0]);
  const [penWidth, setPenWidth] = useState<number>(PEN_WIDTHS[1]);
  const strokes = useDrawingStore((s) => s.strokes);
  const setSnapshot = useDrawingStore((s) => s.setSnapshot);
  const remainingMs = useCountdownRemaining(state.countdownDeadline);

  const isMyTurn = state.activeTeam === role;
  const amIDrawer = state.phase !== "choosing_drawer" && state.drawerName === displayName && isMyTurn;
  const urgent = remainingMs !== null && remainingMs <= URGENT_THRESHOLD_MS;

  // Pull a fresh snapshot on every genuinely new moment (mount/reconnect,
  // a new turn, drawing -> guessing) — see requestDrawingSnapshot's own
  // doc comment: this is the reconnect story AND the reveal story, both
  // for free, because the server always answers with what's true right
  // now (empty for a viewer not yet allowed to see it).
  useEffect(() => {
    void requestDrawingSnapshot().then(({ strokes: fresh }) => setSnapshot(fresh));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.currentPromptIndex]);

  // A REAL, REPRODUCED bug this closes (found via a real browser, not a
  // code read): the CHOOSE_DRAWER race has an explicit loser (both
  // teammates may legally click "I'll draw!" — see PlayerGeoPanel's own
  // "un ping pour deux" precedent for why racing two real players is a
  // deliberate product decision, not a bug to prevent). The losing
  // teammate's own `sendAction` call comes back `{ ok: false }`
  // (WRONG_PHASE — the winner already moved the phase to "drawing"), so
  // `error` gets set — but nothing ever cleared it afterward, so "You
  // can't do that right now" sat on the loser's screen for the REST OF
  // THE TURN, through drawing and guessing, reading as a persistent,
  // unexplained error rather than the harmless "someone else was
  // faster" it actually was. Render-phase reset (same pattern used
  // throughout this app's Content Studio editors — a genuine phase
  // change is exactly the "whatever that error was about is over now"
  // signal), not a `useEffect`: calling setState during render here is
  // fine because it bails out before committing the stale render,
  // avoiding the extra render+effect pass a `useEffect` version would
  // cost.
  if (syncedPhase !== state.phase) {
    setSyncedPhase(state.phase);
    setError(null);
  }

  // The secret word — ONLY ever resolves to a real value for the actual
  // drawer (drawing.ts re-checks live identity on every call); everyone
  // else always gets `null` back, harmlessly. Nothing to reset when
  // `amIDrawer` goes false — `promptText` is only ever rendered guarded
  // behind `amIDrawer` below, so a stale value sitting unused in state
  // is harmless (and resetting it here would just be a second,
  // synchronous setState the effect doesn't need).
  useEffect(() => {
    if (!amIDrawer) return;
    void requestDrawingPrompt().then(({ text }) => setPromptText(text));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amIDrawer, state.currentPromptIndex]);

  async function chooseDrawer() {
    setChoosing(true);
    setError(null);
    const result = await sendAction({ type: "CHOOSE_DRAWER" });
    // WRONG_PHASE here specifically means "my teammate's claim landed
    // first" — the ordinary, expected outcome of a fair race (see
    // types.ts's own doc comment on CHOOSE_DRAWER), never a real
    // problem worth alarming this player about. The render-phase-reset
    // above is a real fix for the general case, but can't fully cover
    // this one on its own: the broadcast that flips `state.phase` to
    // "drawing" can (and, confirmed via a real two-browser race, does)
    // arrive and clear a PRIOR error before this specific rejection
    // even lands, so a naive setError here would re-introduce a fresh
    // stale banner one tick later. Every other rejection reason still
    // surfaces normally — only a lost race is silent.
    if (!result.ok && result.error && result.error.code !== "WRONG_PHASE") setError(result.error);
    setChoosing(false);
  }

  async function handleStroke(stroke: { points: { x: number; y: number }[]; color: string; width: number }) {
    const result = await sendStroke(stroke);
    if (!result.ok && result.error) setError({ code: result.error, message: result.error });
  }

  return (
    <motion.div className={styles.wrap} initial="hidden" animate="show" variants={fadeUp(reduced)}>
      <div className={styles.header}>
        <p className={styles.turnLabel}>
          {TEAM_LABEL[state.activeTeam]}&apos;s turn — {state.currentPromptIndex + 1} / {state.prompts.length}
        </p>
        <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} />
      </div>

      <AnimatePresence mode="wait">
        {error && (
          <motion.p
            key={error.code}
            className={styles.errorBanner}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {readableDrawingError(error.code, error.message)}
          </motion.p>
        )}
      </AnimatePresence>

      {state.phase === "choosing_drawer" && isMyTurn && (
        <motion.div className={styles.chooseBlock} initial="hidden" animate="show" variants={popIn(reduced)}>
          <span className={styles.chooseIcon} aria-hidden="true">
            🎨
          </span>
          <p className={styles.instruction}>It&apos;s your team&apos;s turn — who&apos;s drawing?</p>
          <Button size="lg" fullWidth loading={choosing} disabled={choosing} onClick={() => void chooseDrawer()}>
            I&apos;ll draw!
          </Button>
        </motion.div>
      )}

      {state.phase === "choosing_drawer" && !isMyTurn && (
        <div className={styles.waitingBlock}>
          <span className={styles.pulseDot} aria-hidden="true" />
          <p className={styles.statusLine}>Waiting for {TEAM_LABEL[state.activeTeam]} to pick a drawer…</p>
        </div>
      )}

      {/* "drawing": only the active team ever sees a canvas at all — the
          opposing team gets nothing to look at yet, same guarantee the
          server itself enforces (mayViewLiveStrokes, drawing.ts). */}
      {state.phase === "drawing" && isMyTurn && (
        <motion.div className={styles.canvasBlock} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 12, duration: 0.4 })}>
          {amIDrawer && promptText && (
            <motion.div className={styles.promptCard} initial="hidden" animate="show" variants={popIn(reduced)}>
              <span className={styles.promptEyebrow}>YOUR WORD</span>
              <p className={styles.promptWord}>{promptText}</p>
            </motion.div>
          )}
          {!amIDrawer && <p className={styles.instruction}>{TEAM_LABEL[role]} is drawing — watch closely!</p>}

          {/* The one number every drawer's eyes keep flicking back to —
              bigger and bolder than the shared CountdownBadge every
              other role gets (see this file's own URGENT_THRESHOLD_MS),
              because racing the clock IS the core tension of this
              specific role in this specific game, not a side fact. */}
          {remainingMs !== null && (
            <p className={[styles.bigCountdown, urgent && styles.bigCountdownUrgent].filter(Boolean).join(" ")}>
              {formatCountdown(remainingMs)}
            </p>
          )}

          <DrawingCanvas
            strokes={strokes}
            readOnly={!amIDrawer}
            color={penColor}
            width={penWidth}
            onStrokeComplete={amIDrawer ? (s) => void handleStroke(s) : undefined}
          />
          {amIDrawer && (
            <div className={styles.toolbar}>
              <div className={styles.swatchRow}>
                {PEN_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Pen color ${c}`}
                    aria-pressed={penColor === c}
                    className={[styles.swatch, penColor === c && styles.swatchActive].filter(Boolean).join(" ")}
                    style={{ background: c }}
                    onClick={() => setPenColor(c)}
                  />
                ))}
                <select
                  aria-label="Pen width"
                  className={styles.widthSelect}
                  value={penWidth}
                  onChange={(e) => setPenWidth(Number(e.target.value))}
                >
                  {PEN_WIDTHS.map((w) => (
                    <option key={w} value={w}>
                      {w}px
                    </option>
                  ))}
                </select>
              </div>
              <div className={styles.strokeActions}>
                {/* A slipped tap on a touch canvas used to leave "erase
                    the whole drawing" as the only correction available,
                    under a running timer — this is the real, audited
                    fix: undo just the last stroke, same shape as
                    `sendDrawingClear` right next to it (src/server/
                    sockets/drawing.ts's own `drawing:undo`). Disabled
                    once there's nothing left to undo, same as `strokes`
                    already gates Clear implicitly via there being
                    nothing visible to clear. */}
                <Button size="sm" variant="secondary" disabled={strokes.length === 0} onClick={() => void sendDrawingUndo()}>
                  Undo
                </Button>
                <Button size="sm" variant="secondary" disabled={strokes.length === 0} onClick={() => void sendDrawingClear()}>
                  Clear
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      )}

      {state.phase === "drawing" && !isMyTurn && (
        <div className={styles.waitingBlock}>
          <span className={styles.pulseDot} aria-hidden="true" />
          <p className={styles.statusLine}>{TEAM_LABEL[state.activeTeam]} is drawing — the reveal comes once time runs out.</p>
        </div>
      )}

      {/* "guessing": the round is over, revealed to everyone now (same
          reasoning as GeoGuessr's own post-reveal visibility) — the
          fresh `requestDrawingSnapshot` pull above already fetched the
          real strokes for every role the instant phase left "drawing". */}
      {state.phase === "guessing" && (
        <motion.div className={styles.canvasBlock} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 12, duration: 0.4 })}>
          <motion.p className={styles.timesUpHeadline} initial="hidden" animate="show" variants={popIn(reduced)}>
            {isMyTurn ? (amIDrawer ? "Time's up! Has your teammate guessed it?" : "Time's up! Shout your guess!") : `Here's what ${TEAM_LABEL[state.activeTeam]} drew.`}
          </motion.p>
          <DrawingCanvas strokes={strokes} readOnly />
        </motion.div>
      )}

      {/* "resolved": the Host just judged (or skipped) this turn — the
          drawing stays up while the outcome sinks in, same real reaction
          beat HostDrawingPanel's own "resolved" card gives the Host (see
          that component's own doc comment for the gap this closes). A
          REAL regression this specifically guards against: `DrawingPhase`
          gained a fourth value here, and every other block above only
          ever matches "choosing_drawer"/"drawing"/"guessing" by name —
          without this block, a resolved turn would render nothing at all
          for a player, a blank screen right when something just happened. */}
      {state.phase === "resolved" && (
        <motion.div className={styles.canvasBlock} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 12, duration: 0.4 })}>
          <motion.p className={styles.timesUpHeadline} initial="hidden" animate="show" variants={popIn(reduced)}>
            {resolvedOutcome(state, role)}
          </motion.p>
          <DrawingCanvas strokes={strokes} readOnly />
        </motion.div>
      )}
    </motion.div>
  );
}

/** What the just-resolved turn's own headline says, from THIS player's own team's point of view — mirrors HostDrawingPanel's own `lastTurnOutcome`, just phrased for a player rather than the Host's régie. `history`'s last entry is always this turn's own outcome the instant `phase === "resolved"` (engine.ts's `applyJudgeGuess`/`applySkipTurn`, both append before pausing). */
function resolvedOutcome(state: DrawingState, role: "TEAM_A" | "TEAM_B"): string {
  const last = state.history[state.history.length - 1];
  if (!last) return "Waiting for the host to continue…";
  if (last.correct === null) return "Turn skipped — no point awarded.";
  const wonBy = last.correct ? last.team : last.team === "TEAM_A" ? "TEAM_B" : "TEAM_A";
  if (wonBy === role) return last.correct ? "You got it! ✓" : "The other team missed — point to you!";
  return last.correct ? `${TEAM_LABEL[wonBy]} got it.` : `Wrong — point to ${TEAM_LABEL[wonBy]}.`;
}
