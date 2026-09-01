"use client";

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import type { DrawingState } from "@/domain/game/drawing";
import { useDrawingStore } from "@/app/_shared/drawingStore";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog } from "@/ui";
import { CountdownBadge } from "@/app/_shared/CountdownBadge";
import { JudgeRow } from "@/app/_shared/JudgeRow";
import { RoundStatus } from "@/app/_shared/RoundStatus";
import { readableDrawingError } from "./drawingErrorMessages";
import { DrawingCanvas } from "./DrawingCanvas";
import styles from "./HostDrawingPanel.module.css";

export interface HostDrawingPanelProps {
  state: DrawingState;
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
  requestDrawingSnapshot: () => Promise<{ strokes: { points: { x: number; y: number }[]; color: string; width: number }[] }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

/**
 * The host's régie — always sees the live canvas (HOST is never subject
 * to the drawing.ts privacy check: `mayViewLiveStrokes` returns true for
 * HOST regardless of phase), gets the secret word for free via the
 * ordinary, unredacted `game:state` (never needs `requestDrawingPrompt`
 * — see view.ts's `toPublicView`, which only ever blanks the prompt for
 * non-HOST roles), and is the ONLY role that judges a guess
 * (JUDGE_GUESS, correct/wrong, once the round reaches "guessing" — the
 * literal "the host clicks Correct/Wrong" product decision, players
 * guess out loud/in chat, there's no in-app guess-text field).
 */
type PendingAction = "JUDGE" | "SKIP_TURN" | "NEXT_PROMPT" | "END_GAME" | null;

/** The other team — the inverse of whichever one's passed in, same tiny helper every panel that needs it (HostGeoPanel has no equivalent since GeoGuessr never needs to name "the other team" client-side) defines locally rather than importing from the domain engine. */
function otherTeam(team: "TEAM_A" | "TEAM_B"): "TEAM_A" | "TEAM_B" {
  return team === "TEAM_A" ? "TEAM_B" : "TEAM_A";
}

/** What the just-resolved turn's own headline says, and which team (if any) it should be colored for — mirrors HostGeoPanel's/HostPricePanel's own `resultHeadline` reveal pattern. Only ever read while `phase === "resolved"`, when `history`'s last entry is always THIS turn's own outcome (engine.ts's `applyJudgeGuess`/`applySkipTurn`, both append before pausing). */
function lastTurnOutcome(state: DrawingState): { headline: string; winner: "TEAM_A" | "TEAM_B" | null } {
  const last = state.history[state.history.length - 1];
  if (!last) return { headline: "", winner: null };
  if (last.correct === null) return { headline: "TURN SKIPPED — NO POINT", winner: null };
  if (last.correct) return { headline: `${TEAM_LABEL[last.team]} GOT IT!`, winner: last.team };
  const winner = otherTeam(last.team);
  return { headline: `WRONG — POINT TO ${TEAM_LABEL[winner]}`, winner };
}

export function HostDrawingPanel({ state, sendAction, requestDrawingSnapshot }: HostDrawingPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const [pending, setPending] = useState<PendingAction>(null);
  const [adjusting, setAdjusting] = useState<number | null>(null); // the deltaSeconds currently in flight, for that one button's own loading state
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [endGameOpen, setEndGameOpen] = useState(false);
  const strokes = useDrawingStore((s) => s.strokes);
  const setSnapshot = useDrawingStore((s) => s.setSnapshot);

  useEffect(() => {
    void requestDrawingSnapshot().then(({ strokes: fresh }) => setSnapshot(fresh));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.currentPromptIndex]);

  const prompt = state.prompts[state.currentPromptIndex];
  // Always one team or the other (never "neutral" — unlike Jeopardy's
  // buzzedTeam, activeTeam always has a real value) — used to color
  // whichever RoundStatus line names it below.
  const activeTeamTone = state.activeTeam === "TEAM_A" ? "teamA" : "teamB";

  async function act(kind: PendingAction, action: Record<string, unknown>) {
    setPending(kind);
    setError(null);
    const result = await sendAction(action);
    if (!result.ok && result.error) setError(result.error);
    setPending(null);
  }

  async function judge(correct: boolean) {
    await act("JUDGE", { type: "JUDGE_GUESS", correct });
  }

  async function adjustCountdown(deltaSeconds: number) {
    setAdjusting(deltaSeconds);
    setError(null);
    const result = await sendAction({ type: "ADJUST_COUNTDOWN", deltaSeconds });
    if (!result.ok && result.error) setError(result.error);
    setAdjusting(null);
  }

  async function endGameNow() {
    setPending("END_GAME");
    setError(null);
    const result = await sendAction({ type: "END_GAME" });
    if (!result.ok && result.error) setError(result.error);
    setPending(null);
  }

  return (
    <motion.div className={styles.wrap} initial="hidden" animate="show" variants={fadeUp(reduced)}>
      <Card variant="raised">
        <CardBody>
          <AnimatedScoreDisplay
            teamAName="Team A"
            teamAScore={state.scores.TEAM_A}
            teamBName="Team B"
            teamBScore={state.scores.TEAM_B}
            label={state.status === "finished" ? `Game over — ${state.winner === "TIE" ? "tie" : `${state.winner} wins`}` : undefined}
          />
        </CardBody>
      </Card>

      {state.status !== "finished" && (
        <div className={styles.endGameRow}>
          {/* Grouped separately from "End game" right next to it (a left
              divider, see the CSS) — same "the destructive action isn't
              part of the ordinary controls cluster" fix HostBoardPanel's
              own endGameRow got this pass. */}
          <div className={styles.timerGroup}>
            {/* "Turn ends in", not "Drawing ends in" — this counts down
                the whole turn's own timer, not specifically the drawing
                half of it (it's just the only phase the countdown is
                ever actually running in); matches the "Turn"/"Prompt"
                vocabulary this panel uses everywhere else (turnLabel
                just below). */}
            <CountdownBadge deadlineMs={state.countdownDeadline} label="Turn ends in" />
            {/* Only meaningful while a drawing countdown is actually
                running (ADJUST_COUNTDOWN is WRONG_PHASE/NO_COUNTDOWN_ACTIVE
                otherwise) — "add/remove time for a hard prompt," the
                literal cahier des charges ask, live on top of the
                per-prompt default duration from Content Studio. */}
            {state.phase === "drawing" && (
              <div className={styles.timeAdjustRow}>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={adjusting === -10}
                  disabled={adjusting !== null}
                  onClick={() => void adjustCountdown(-10)}
                >
                  −10s
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={adjusting === 10}
                  disabled={adjusting !== null}
                  onClick={() => void adjustCountdown(10)}
                >
                  +10s
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={adjusting === 30}
                  disabled={adjusting !== null}
                  onClick={() => void adjustCountdown(30)}
                >
                  +30s
                </Button>
              </div>
            )}
          </div>
          <div className={styles.dangerGroup}>
            <Button variant="danger" size="sm" disabled={pending !== null} onClick={() => setEndGameOpen(true)}>
              End game
            </Button>
          </div>
        </div>
      )}

      {error && <p className={styles.errorBanner}>{readableDrawingError(error.code, error.message)}</p>}

      <p className={styles.turnLabel}>
        {TEAM_LABEL[state.activeTeam]}&apos;s turn — prompt {state.currentPromptIndex + 1} / {state.prompts.length}
      </p>

      {/* The one dominant status line this panel was missing for its two
          "in progress, nobody's judged anything yet" phases — "guessing"
          already had `judgeLabel` (below) and "resolved" already had its
          own result headline; `choosing_drawer`/`drawing` had nothing
          bigger than this Card's own muted subtitle. Same shared
          component every Host panel uses now, so a Host reads the exact
          same visual weight for "what's happening" whichever game is
          live. */}
      {state.phase === "choosing_drawer" && (
        <RoundStatus tone={activeTeamTone}>Waiting for {TEAM_LABEL[state.activeTeam]} to pick a drawer</RoundStatus>
      )}
      {state.phase === "drawing" && <RoundStatus tone={activeTeamTone}>{TEAM_LABEL[state.activeTeam]} is drawing</RoundStatus>}

      {/* The one thing missing before this pass: nothing here ever told
          the Host WHY there's no "Start timer" button anywhere on this
          panel, unlike GeoGuessr's own Host-started countdown — the
          drawing timer starts itself the instant a drawer's chosen
          (engine.ts's applyChooseDrawer), and this is the one moment
          that fact actually matters (right before it happens). */}
      {state.phase === "choosing_drawer" && <p className={styles.timerHint}>Timer runs automatically once a drawer is chosen.</p>}

      {/* The decision — once there's actually one to make — sits ABOVE
          the canvas, not below it. A real, observed gap this closes: the
          canvas is a big square (necessarily, for real drawing
          precision), and once judging strokes were done, DID (Correct/
          Incorrect and then Next prompt) used to sit far enough below it
          that reaching them meant scrolling even on a 1280px desktop —
          the exact "action buried under now-secondary content" problem
          Jeopardy's own board already got reordered for. The canvas
          itself is still right here for reference, just no longer
          blocking the one thing the Host actually needs to click. */}
      {state.phase === "guessing" && state.status !== "finished" && (
        <motion.div initial="hidden" animate="show" variants={popIn(reduced)}>
          <Card variant="raised">
            <CardBody>
              <RoundStatus tone={activeTeamTone}>Did {TEAM_LABEL[state.activeTeam]} guess it right?</RoundStatus>
              <JudgeRow
                onCorrect={() => void judge(true)}
                onIncorrect={() => void judge(false)}
                correctLoading={pending === "JUDGE"}
                incorrectLoading={pending === "JUDGE"}
                disabled={pending !== null}
              />
            </CardBody>
          </Card>
        </motion.div>
      )}

      {/* "resolved" — the turn was just judged or skipped; the outcome
          stays on screen (a real reaction beat, same shape as
          GeoGuessr's own round reveal) until the Host explicitly paces
          on. A REAL, REPORTED gap this closes: judging used to cut
          straight to the NEXT team's own fresh prompt in the same
          instant, giving the Host zero time to actually see who just
          won the point before the next one was already live. */}
      {state.phase === "resolved" && (
        <motion.div initial="hidden" animate="show" variants={popIn(reduced)}>
          <Card variant="raised">
            <CardBody>
              <div className={styles.resultBlock}>
                <RoundStatus tone={lastTurnOutcome(state).winner === null ? "neutral" : lastTurnOutcome(state).winner === "TEAM_A" ? "teamA" : "teamB"}>
                  {lastTurnOutcome(state).headline}
                </RoundStatus>
              </div>
              {state.status !== "finished" && (
                <div className={styles.nextPromptRow}>
                  <Button size="lg" fullWidth loading={pending === "NEXT_PROMPT"} disabled={pending !== null} onClick={() => void act("NEXT_PROMPT", { type: "NEXT_PROMPT" })}>
                    Next prompt →
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </motion.div>
      )}

      {/* `key={currentPromptIndex}` — a real turn change re-enters this
          block once, same "genuine transition, never a loop" convention
          as GeoGuessr's own `key={currentRoundIndex}` on its round Card. */}
      <motion.div key={state.currentPromptIndex} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 10, duration: 0.35 })}>
        <Card>
          <CardHeader
            title={prompt?.text || "—"}
            // "Waiting for TEAM to pick a drawer" dropped here — the new
            // RoundStatus line above already says it; keeping both was
            // the exact same fact twice at two different volumes.
            subtitle={state.drawerName ? `Drawer: ${state.drawerName}` : undefined}
          />
          <CardBody>
            <DrawingCanvas strokes={strokes} readOnly />
          </CardBody>
        </Card>
      </motion.div>

      <div className={styles.teamStatusRow}>
        {(["TEAM_A", "TEAM_B"] as const).map((team) => (
          <div key={team} className={styles.teamStatus}>
            <Badge variant={team === "TEAM_A" ? "teamA" : "teamB"} dot>
              {TEAM_LABEL[team]}
            </Badge>
            <span className={team === state.activeTeam ? styles.active : styles.idle}>
              {team === state.activeTeam && <span className={styles.teamPulseDot} aria-hidden="true" />}
              {team === state.activeTeam ? "Up now" : "Waiting"}
            </span>
          </div>
        ))}
      </div>

      {/* Hidden once "resolved" — that phase already has its own Next
          prompt action to pace forward, so a second "abandon this turn"
          escape hatch right next to it would be redundant (same reasoning
          as HostBoardPanel's own Close question hide). Same discreet
          ghost styling as every other engine's own Skip round. */}
      {state.phase !== "resolved" && state.status !== "finished" && (
        <div className={styles.closeRow}>
          <Button variant="ghost" size="sm" loading={pending === "SKIP_TURN"} disabled={pending !== null} onClick={() => void act("SKIP_TURN", { type: "SKIP_TURN" })}>
            Skip turn (no winner)
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={endGameOpen}
        title="End this game now?"
        description="Whatever turn is in progress is abandoned. The winner is whoever's ahead right now, or a tie if the scores are even."
        confirmLabel="End game"
        danger
        confirming={pending === "END_GAME"}
        onCancel={() => setEndGameOpen(false)}
        onConfirm={() => {
          setEndGameOpen(false);
          void endGameNow();
        }}
      />
    </motion.div>
  );
}
