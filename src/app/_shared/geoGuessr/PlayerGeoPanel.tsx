"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { Button, ClickableImageMap, type MapLine, type MapMarker } from "@/ui";
import { readableGeoError } from "./gameErrorMessages";
import { formatDistance } from "./format";
import { CountdownBadge } from "@/app/_shared/CountdownBadge";
import { useRevealStage, REVEAL_STAGE_ORDER } from "./useRevealStage";
import { VictoryGlow } from "@/app/_shared/VictoryGlow";
import styles from "./PlayerGeoPanel.module.css";

export interface PlayerGeoPanelProps {
  state: GeoGuessrState;
  role: "TEAM_A" | "TEAM_B";
  /** This viewer's OWN display name — the same string the server injects into `byName` on every SET_GUESS this client sends (src/server/sockets/game.ts). Used ONLY to figure out which of `myProposals`, if any, is this specific player's own (engine.ts's applySetGuess doc comment on the new one-proposal-per-player behavior) — never sent anywhere, never trusted for anything server-authoritative. */
  displayName: string;
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };
const MARKER_COLOR: Record<"TEAM_A" | "TEAM_B", "teamA" | "teamB"> = { TEAM_A: "teamA", TEAM_B: "teamB" };

/**
 * The player's guess UI — "PLACE A SPOT" -> tap the map (once per
 * teammate) -> "LOCK" whichever spot the team wants to go with ->
 * "GUESS LOCKED". Every proposal/lock is a real `game:action`; this
 * component never decides anything about whether one is allowed, it
 * only reflects `state.proposals[role]`/`state.lockedTeams` — both
 * already scoped to exactly what this role is allowed to see (view.ts's
 * toPublicView: the OTHER team's live proposals are never even sent to
 * this client before reveal, so there's nothing here that could leak
 * them even by accident).
 *
 * Redesigned for the "map is the hero, one action at a time" pass (see
 * todos.md for the full audit/report): the map now takes almost the
 * whole screen, chrome above it is a single instruction line (not a
 * badge + a caption + a warning stacked), and the old per-proposal list
 * of bordered rows-with-buttons became a single ARMED/LOCK bottom
 * action area — exactly one teammate's spot is "armed" at a time (a
 * plain derived value below, not new server state), a small chip lets
 * you switch which one before locking, and ONE big button
 * ("LOCK GUESS") commits it. Two teammates, two pins, one lock — and,
 * since then, ONE pin per teammate, not unbounded: a single shared pin
 * meant either teammate silently overwrote the other's placement, a
 * real reported problem ("un ping pour deux ça va pas du tout"), which
 * SET_GUESS appending a candidate to `state.proposals[role]` fixed; but
 * appending blindly ALSO let the SAME player rack up multiple pins of
 * their own with repeated taps, an equally real reported problem the
 * other direction ("je peux avoir deux pings pour un joueur, c'est un
 * ping par joueur"). `byName` (GeoProposal's own doc comment) is what
 * makes telling those apart possible at all now — the engine
 * (applySetGuess) replaces a player's own still-open proposal in place
 * on a second tap instead of appending a second one, so tapping again
 * always means "move MY pin," never "add another of my own."
 * LOCK_GUESS then finalizes exactly ONE proposal (any teammate can lock
 * any of them, including one the other one placed) as the team's real,
 * scored guess.
 */
export function PlayerGeoPanel({ state, role, displayName, sendAction }: PlayerGeoPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const [locking, setLocking] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  // Which of the team's own proposals is currently "armed" to be locked
  // — a pure UI selection, not server state (LOCK_GUESS still names an
  // explicit `proposalIndex`, unchanged). `null` until the player
  // deliberately picks a DIFFERENT one than the sensible default below.
  const [armedByName, setArmedByName] = useState<string | null>(null);

  const otherTeam = role === "TEAM_A" ? "TEAM_B" : "TEAM_A";
  const round = state.rounds[state.currentRoundIndex];
  const myProposals = state.proposals[role];
  // Which of the team's own proposals (if any) is THIS specific player's
  // own — see PlayerGeoPanelProps.displayName's own doc comment. Purely
  // a client-side "what should the instruction text say" question; the
  // engine (applySetGuess) makes this exact same determination
  // server-side, authoritatively, off the identical `byName` value.
  const myOwnProposal = myProposals.find((spot) => spot.byName === displayName);
  const myLocked = state.lockedTeams.includes(role);
  const otherLocked = state.lockedTeams.includes(otherTeam);
  const revealed = state.phase === "revealed";
  // The SAME staged reveal Display already uses (useRevealStage's own
  // doc comment on why this is now a shared hook, not two copies) —
  // "target -> Team A -> Team B -> distances -> winner," a real
  // requested gap: the Player's own reveal used to dump everything on
  // screen in one flat instant while Display already built tension one
  // beat at a time. Same `resetKey` shape (round + revealed) so a fresh
  // round always restarts the sequence from the top.
  const resetKey = `${state.currentRoundIndex}-${revealed}`;
  const revealStage = useRevealStage(revealed, resetKey, reduced);
  const revealStageIndex = REVEAL_STAGE_ORDER.indexOf(revealStage);

  // The proposal actually armed right now — defaults to the player's
  // OWN spot if they have one, else whichever exists. A render-phase
  // derivation (same "adjust to match real data" pattern this codebase
  // already uses elsewhere, e.g. ClickableImageMap.tsx's own
  // `openedForImage`), not a `useEffect`: if the armed one gets moved or
  // a teammate's disappears, this falls back cleanly on the very next
  // render instead of pointing at something stale for one tick.
  const armedProposal = (armedByName && myProposals.find((spot) => spot.byName === armedByName)) || myOwnProposal || myProposals[0] || null;

  async function proposeSpot(x: number, y: number) {
    setError(null);
    const result = await sendAction({ type: "SET_GUESS", x, y });
    if (!result.ok && result.error) setError(result.error);
  }

  async function lockArmed() {
    if (!armedProposal) return;
    const index = myProposals.indexOf(armedProposal);
    if (index < 0) return;
    setLocking(true);
    setError(null);
    const result = await sendAction({ type: "LOCK_GUESS", proposalIndex: index });
    if (!result.ok && result.error) setError(result.error);
    setLocking(false);
  }

  if (!round) {
    return (
      <div className={styles.emptyState}>
        <p className={styles.statusLine}>{state.status === "finished" ? "Game finished." : "Waiting for the round to load…"}</p>
      </div>
    );
  }

  const markers: MapMarker[] = [];
  const lines: MapLine[] = [];
  if (revealed && state.roundResult) {
    const result = state.roundResult;
    // Staged exactly like Display's own reveal (useRevealStage's doc
    // comment) — target first, then each team's guess arrives WITH its
    // own distance line at the same beat (a line with no marker at its
    // end reads as a stray mark, not "here's how far off they were").
    // Fixed TEAM_A-then-TEAM_B order regardless of which team is
    // viewing — every role sees the same broadcast moment on the same
    // timing, just from its own seat; only the LABEL changes ("YOU" for
    // this viewer's own team, same as the original flat version).
    if (revealStageIndex >= REVEAL_STAGE_ORDER.indexOf("reveal")) {
      markers.push({ id: "target", x: result.targetX, y: result.targetY, color: "target", label: "TARGET" });
    }
    (["TEAM_A", "TEAM_B"] as const).forEach((team) => {
      const guess = result.guesses[team];
      // A `null` guess (only reachable via a countdown forcing the
      // round closed with zero proposals queued — GeoRoundResult's own
      // doc comment) has no real spot to mark.
      if (!guess) return;
      if (revealStageIndex >= REVEAL_STAGE_ORDER.indexOf(team === "TEAM_A" ? "teamA" : "teamB")) {
        markers.push({ id: team, x: guess.x, y: guess.y, color: MARKER_COLOR[team], label: team === role ? "YOU" : TEAM_LABEL[team] });
        lines.push({ id: `line-${team}`, from: guess, to: { x: result.targetX, y: result.targetY }, color: MARKER_COLOR[team] });
      }
    });
  } else {
    // Every one of the team's own still-open proposals, not just one —
    // see this file's own top comment. Keyed by the spot's own
    // coordinates, not array index: an index-based id would make React
    // reuse the SAME marker element for whatever's now at that index,
    // sliding it to the new spot instead of the old one popping out and
    // the new one popping in — a real, visible glitch on the exact thing
    // that now happens constantly (a player moving their own proposal
    // replaces it in place, engine.ts's applySetGuess), not just the
    // rare defensive MAX_PLAYERS_PER_TEAM-cap-drop case this used to be
    // about. Label is the proposer's own FULL `byName` (GeoProposal's
    // doc comment) — a real, reported bug with an earlier 2-letter-
    // initials version of this label: two teammates with different
    // names but the same first-two-letters ("Sam"/"Sarah") read as
    // identical "SA"/"SA" pins with zero way to tell them apart on the
    // map itself. The raw name never collides that way (only two
    // teammates sharing the exact SAME display name could still
    // collide, a genuinely unsolvable identity ambiguity, not a
    // labeling bug). The ARMED one gets both `pulse` (draws the eye the
    // instant it changes) AND `selected` (a persistent ring so it's
    // still obvious a moment later, once the pulse has stopped drawing
    // attention to itself) — see MapMarker.selected's own doc comment.
    myProposals.forEach((spot) => {
      markers.push({
        id: `proposal-${spot.x}-${spot.y}`,
        x: spot.x,
        y: spot.y,
        color: MARKER_COLOR[role],
        label: spot.byName,
        pulse: !myLocked && spot === armedProposal,
        selected: !myLocked && spot === armedProposal,
      });
    });
  }

  // A REAL, REPRODUCED bug this closes — see ClickableImageMap.tsx's own
  // `onMarkerClick` doc comment: tapping directly on an EXISTING pin
  // (yours or a teammate's) now ARMS it for locking, full stop — it can
  // never also move/replace your own proposal the way any other map tap
  // does. Confirmed directly, two real players: tapping exactly on a
  // teammate's pin used to silently drag your OWN pin on top of it
  // ("pourquoi mon pin a bougé"); tapping a pin now only ever selects,
  // tapping empty map is still the only thing that places/moves.
  function onMarkerClick(markerId: string) {
    const spot = myProposals.find((s) => `proposal-${s.x}-${s.y}` === markerId);
    if (spot) setArmedByName(spot.byName);
  }

  // One instruction line, one voice — never a badge AND a caption AND a
  // warning stacked on top of each other (the old version). Exactly one
  // of these is ever true at a time.
  let instruction = "";
  if (revealed) {
    instruction = "";
  } else if (myLocked) {
    instruction = "";
  } else if (myProposals.length === 0) {
    instruction = "TAP THE MAP TO GUESS";
  } else if (myProposals.length > 1) {
    instruction = "CHOOSE A SPOT TO LOCK";
  } else if (myOwnProposal) {
    instruction = "TAP AGAIN TO MOVE YOUR SPOT";
  } else {
    instruction = "READY TO LOCK";
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <p className={styles.roundLabel}>
            ROUND {state.currentRoundIndex + 1} / {state.rounds.length}
          </p>
          <p className={styles.scoreLine}>
            <span className={styles.scoreA}>{state.scores.TEAM_A}</span>
            <span className={styles.scoreDivider}>–</span>
            <span className={styles.scoreB}>{state.scores.TEAM_B}</span>
          </p>
        </div>
        {!revealed && round.question && <p className={styles.question}>{round.question}</p>}
        {!revealed && !myLocked && instruction && <p className={styles.instruction}>{instruction}</p>}
        {!revealed && !myLocked && otherLocked && <p className={styles.otherTeamLockedNote}>{TEAM_LABEL[otherTeam]} has already locked in.</p>}
        <CountdownBadge
          deadlineMs={state.countdownDeadline}
          label={state.currentRoundIndex >= state.rounds.length - 1 ? "Game ends in" : "Round ends in"}
          className={styles.countdown}
        />
        {/* The one "this is the moment" caption during the staged
            reveal build-up — hidden once the winner headline itself
            takes over below (two captions claiming to be THE moment at
            once undercuts the one that actually matters), same
            convention Display's own reveal already uses. */}
        {revealed && revealStage !== "winner" && (
          <motion.p key={`caption-${revealStage}`} className={styles.revealCaption} initial="hidden" animate="show" variants={popIn(reduced)}>
            {revealStage === "locked" ? "LOCKED" : "REVEALING…"}
          </motion.p>
        )}
      </div>

      {error && <p className={styles.errorBanner}>{readableGeoError(error.code, error.message)}</p>}

      {/* `key={currentRoundIndex}` — the map genuinely re-enters on a
          real round change, never a loop and never what DECIDES the
          round changed — that's still purely `state.currentRoundIndex`,
          moved only by the server's own NEXT_ROUND broadcast. No Card
          wrapper any more — the map IS the screen now, not content
          inside a bordered box competing with everything around it. */}
      <motion.div key={state.currentRoundIndex} className={styles.mapWrap} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 14, duration: 0.4 })}>
        <ClickableImageMap
          imageUrl={round.imageUrl}
          alt={round.title || `Round ${state.currentRoundIndex + 1} map`}
          markers={markers}
          lines={lines}
          onPick={!revealed && !myLocked ? proposeSpot : undefined}
          onMarkerClick={!revealed && !myLocked ? onMarkerClick : undefined}
          disabled={myLocked}
          empty={!round.imageUrl}
          emptyLabel="This round's map is unavailable right now."
        />
      </motion.div>

      {/* The ONE bottom action area — replaces the old list of
          bordered rows, each with its own "Lock this spot" button. */}
      {!revealed && !myLocked && myProposals.length > 0 && (
        <div className={styles.actionArea}>
          {myProposals.length > 1 && (
            <div className={styles.chipRow}>
              {myProposals.map((spot) => (
                <button
                  key={spot.byName}
                  type="button"
                  className={[styles.chip, spot === armedProposal && styles.chipArmed].filter(Boolean).join(" ")}
                  onClick={() => setArmedByName(spot.byName)}
                  aria-pressed={spot === armedProposal}
                >
                  <span className={[styles.chipDot, styles[MARKER_COLOR[role]]].join(" ")} aria-hidden="true" />
                  {spot.byName}
                </button>
              ))}
            </div>
          )}
          {/* A REAL, REPRODUCED bug this closes: interpolating the armed
              player's own name into the button's label ("LOCK MAXIMILIAN-
              ALEXANDER'S GUESS") had no length limit — confirmed
              directly at 320px, the text genuinely overflowed OUTSIDE
              the button's own edges, clipped and illegible ("CK
              MAXIMILIAN-ALEXANDER'S GUE"). Always "LOCK GUESS" now,
              regardless of name length or how many proposals exist —
              which spot that means is never ambiguous without it: the
              chip above is gold-outlined, and the SAME pin on the map
              itself now carries a persistent gold ring
              (`ClickableImageMap`'s own `MapMarker.selected`) — two
              independent, always-visible signals already answer "which
              one," the button restating the name was genuinely
              redundant text, not information. */}
          <Button size="lg" fullWidth loading={locking} disabled={locking || !armedProposal} onClick={() => void lockArmed()}>
            LOCK GUESS
          </Button>
        </div>
      )}

      {!revealed && myLocked && (
        // A real arrival, not just a state swap — the backend already
        // decided this lock is real (server-authoritative, same as
        // every other GeoGuessr transition) by the time this renders;
        // the pop is purely how that fact FEELS landing on screen.
        // Big, centered, unmistakable — item "PAS DE CONFUSION" in the
        // brief: a player must never wonder "is my guess registered."
        <motion.div className={styles.lockedBlock} initial="hidden" animate="show" variants={popIn(reduced)}>
          <div className={[styles.lockedCheck, styles[MARKER_COLOR[role]]].join(" ")}>✓</div>
          <p className={styles.lockedHeadline}>GUESS LOCKED</p>
          <p className={styles.statusLine}>{otherLocked ? "Revealing…" : `Waiting for ${TEAM_LABEL[otherTeam]}…`}</p>
        </motion.div>
      )}

      {/* Staged with the map above, not dumped on screen the instant
          `revealed` flips true — distances land once both teams' lines
          have actually drawn, the winner headline (the real payoff)
          only once its own beat arrives. */}
      {revealed && state.roundResult && revealStageIndex >= REVEAL_STAGE_ORDER.indexOf("distances") && (
        <motion.div className={styles.resultWrap} initial="hidden" animate="show" variants={fadeUp(reduced)}>
          <div className={styles.distanceRow}>
            <span className={styles.distanceTeamA}>Team A — {formatDistance(state.roundResult.distances.TEAM_A)}</span>
            <span className={styles.distanceTeamB}>Team B — {formatDistance(state.roundResult.distances.TEAM_B)}</span>
          </div>

          {revealStage === "winner" && (
            <>
              <RoundResultSummary role={role} result={state.roundResult} reduced={reduced} />
              <div className={styles.resultScoreLine}>
                <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} />
              </div>
              <p className={styles.statusLine}>Waiting for the host to continue…</p>
            </>
          )}
        </motion.div>
      )}
    </div>
  );
}

function RoundResultSummary({
  role,
  result,
  reduced,
}: {
  role: "TEAM_A" | "TEAM_B";
  result: NonNullable<GeoGuessrState["roundResult"]>;
  reduced: boolean;
}) {
  const won = result.roundWinner === role;
  const tie = result.roundWinner === "TIE";
  // Personal, consistent framing — "YOU WON"/"YOU LOST"/"ROUND TIED,"
  // never a third-person team announcement ("TEAM B WINS THE ROUND")
  // that never actually told THIS viewer whether they themselves won or
  // lost. The celebratory color+glow is reserved for an actual win, in
  // this viewer's OWN team color — a loss stays calm and muted
  // (`--vb-text-muted`, no glow): the map above (both pins, distances)
  // already shows exactly who was closer, so the headline's only job is
  // the immediate, personal verdict, not a second announcement of which
  // team happened to win. "Fort mais pas kitsch" — celebrating the
  // OPPONENT's color on the losing viewer's own screen would read as
  // congratulating them, not informing you.
  //
  // A REAL, REPRODUCED bug this fixes: `styles[MARKER_COLOR[...]]` used
  // to look up the bare `teamA`/`teamB` tokens — real CSS-module class
  // names (they exist because `.chipDot.teamA`/`.lockedCheck.teamA`
  // COMPOUND selectors elsewhere in this file reference them), but
  // neither has any STANDALONE visual rule of its own; applying one
  // alone to `.resultHeadline` added a real but functionally inert
  // class. Confirmed directly: the headline's computed `color` was
  // always `--vb-text` (plain off-white), never the intended team
  // color, no matter which team actually won. `.resultTeamA`/
  // `.resultTeamB` (below) are the actual color-bearing rules — named
  // that way specifically so this lookup can't silently reach for the
  // wrong token again.
  const colorClass = tie ? styles.resultTie : won ? (role === "TEAM_A" ? styles.resultTeamA : styles.resultTeamB) : styles.resultLoss;
  return (
    <div className={styles.resultBlock}>
      {/* Full-viewport wash — src/app/_shared/VictoryGlow.tsx, the same
          one WinnerReveal.tsx/DisplayGeoPanel.tsx use — reserved for an
          actual win (see the doc comment above), never a tie, never a
          loss. */}
      {won && <VictoryGlow team={role} />}
      <motion.p
        className={[styles.resultHeadline, colorClass].join(" ")}
        initial={reduced ? undefined : { scale: 0.85, opacity: 0 }}
        animate={reduced ? undefined : { scale: 1, opacity: 1 }}
        transition={reduced ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 20 }}
      >
        {tie ? "ROUND TIED" : won ? "YOU WON THE ROUND" : "YOU LOST THE ROUND"}
      </motion.p>
    </div>
  );
}
