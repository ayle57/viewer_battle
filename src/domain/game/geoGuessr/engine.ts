import { isTeamRole, MAX_PLAYERS_PER_TEAM, TEAM_ROLES, type ParticipantRole, type TeamRole } from "@/domain/session";
import { err, ok, type EngineResult, type GameEngine } from "../kernel";
import { addScore, checkFirstToN, leadingTeam, type Scoreboard } from "../scoring";
import { gameFinishedEvent, scoreChangedEvent } from "../events";
import { computeDeadline, isExpired } from "../timer";
import type { CountdownDurationMs } from "../countdown";
import {
  geoGuessrActionSchema,
  geoGuessrConfigSchema,
  type GeoGuess,
  type GeoGuessrAction,
  type GeoGuessrConfig,
  type GeoGuessrEvent,
  type GeoGuessrState,
  type GeoProposal,
  type GeoRoundResult,
} from "./types";
import { toPublicView } from "./view";

/** FIRST TO 6 rounds wins — the product's stated win condition (see types.ts's top comment). Not configurable per game start; a real rule, not a magic number. */
export const GEO_WIN_THRESHOLD = 6;

export function createInitialState(config: GeoGuessrConfig): GeoGuessrState {
  const parsed = geoGuessrConfigSchema.parse(config);
  return {
    status: "in_progress",
    phase: "guessing",
    rounds: parsed.rounds,
    currentRoundIndex: 0,
    proposals: { TEAM_A: [], TEAM_B: [] },
    guesses: { TEAM_A: null, TEAM_B: null },
    lockedTeams: [],
    roundResult: null,
    history: [],
    scores: { TEAM_A: 0, TEAM_B: 0 },
    winner: null,
    countdownDeadline: null,
  };
}

export function apply(state: GeoGuessrState, action: GeoGuessrAction): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  // Re-validated regardless of the static type — see kernel.ts: `action`
  // is what a socket/tRPC handler decoded from untrusted JSON.
  const parsed = geoGuessrActionSchema.safeParse(action);
  if (!parsed.success) {
    return err("INVALID_ACTION", parsed.error.issues[0]?.message ?? "Invalid action");
  }
  const validated = parsed.data;

  if (state.status === "finished") {
    return err("GAME_ALREADY_FINISHED", "This game has already finished.");
  }

  switch (validated.type) {
    case "SET_GUESS":
      return applySetGuess(state, validated.by, { x: validated.x, y: validated.y, byName: validated.byName });
    case "LOCK_GUESS":
      return applyLockGuess(state, validated.by, validated.proposalIndex);
    case "NEXT_ROUND":
      return applyNextRound(state, validated.by);
    case "END_GAME":
      return applyEndGame(state, validated.by);
    case "START_COUNTDOWN":
      return applyStartCountdown(state, validated.by, validated.durationMs, validated.nowMs);
    case "CANCEL_COUNTDOWN":
      return applyCancelCountdown(state, validated.by);
    case "COUNTDOWN_EXPIRED": {
      const { state: nextState, events } = resolveExpiredCountdown(state);
      return ok(nextState, events);
    }
  }
}

/**
 * ONE live proposal per PLAYER, up to MAX_PLAYERS_PER_TEAM players per
 * team — never a shared "team" pin (the original bug this whole feature
 * exists to fix: "un ping pour deux ça va pas du tout"), and never
 * unbounded per-player spam either (a REAL, reported bug: the same
 * player tapping the map twice got TWO separate pins of their own
 * sitting on the map at once, both labeled with their own name — "je
 * peux avoir deux pings pour un joueur, c'est un ping par joueur").
 * `guess.byName` (GeoProposal's own doc comment — server-injected,
 * never client-controlled) is what makes "is this the SAME player
 * proposing again" answerable at all, something the engine genuinely
 * couldn't tell apart before `byName` existed: a second tap from a
 * player who ALREADY has an open proposal REPLACES it in place (moves
 * their own pin) rather than appending a second one; a genuinely
 * DIFFERENT teammate's first tap still appends as before, capped at
 * MAX_PLAYERS_PER_TEAM (oldest dropped first) — a defensive fallback
 * for the edge case of a THIRD distinct name ever appearing (e.g. a
 * departed player's stale proposal plus a new one who took their
 * seat), not the common path any more.
 */
function applySetGuess(state: GeoGuessrState, by: ParticipantRole, guess: GeoProposal): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may set a guess.");
  if (state.phase !== "guessing") {
    return err("WRONG_PHASE", `Cannot set a guess during phase "${state.phase}".`);
  }
  if (state.lockedTeams.includes(by)) {
    return err("TEAM_ALREADY_LOCKED", `${by} has already locked its guess for this round.`);
  }

  const existing = state.proposals[by];
  const ownIndex = existing.findIndex((proposal) => proposal.byName === guess.byName);
  const updated =
    ownIndex >= 0
      ? existing.map((proposal, index) => (index === ownIndex ? guess : proposal))
      : [...existing, guess].slice(-MAX_PLAYERS_PER_TEAM);
  const nextState: GeoGuessrState = { ...state, proposals: { ...state.proposals, [by]: updated } };
  return ok(nextState, [{ type: "GUESS_SET", team: by }]);
}

/** Finalizes ONE specific proposal (`proposalIndex` into `state.proposals[by]`) as the team's real, scored guess — any teammate may lock any proposal, including one they didn't place themselves (same "no per-player identity" reasoning as applySetGuess). */
function applyLockGuess(state: GeoGuessrState, by: ParticipantRole, proposalIndex: number): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may lock a guess.");
  if (state.phase !== "guessing") {
    return err("WRONG_PHASE", `Cannot lock a guess during phase "${state.phase}".`);
  }
  if (state.lockedTeams.includes(by)) {
    return err("TEAM_ALREADY_LOCKED", `${by} has already locked its guess for this round.`);
  }
  const proposal = state.proposals[by][proposalIndex];
  if (!proposal) return err("NO_GUESS_SET", "Propose a spot on the map before locking one in.");
  // Deliberately narrowed back to a plain GeoGuess here, dropping
  // `proposal.byName` — see GeoProposal's own doc comment: `guesses` (and
  // everything downstream of it — `roundResult`, scoring) stays
  // player-identity-free on purpose, same as every other part of this
  // engine. `byName` only ever exists to label a still-open PROPOSAL;
  // once one is locked in it becomes the team's single shared answer,
  // not "so-and-so's" answer.
  const guess: GeoGuess = { x: proposal.x, y: proposal.y };

  const guesses: Record<TeamRole, GeoGuess | null> = { ...state.guesses, [by]: guess };
  const lockedTeams: TeamRole[] = [...state.lockedTeams, by];
  const events: GeoGuessrEvent[] = [{ type: "TEAM_LOCKED", team: by }];

  const bothLocked = TEAM_ROLES.every((team) => lockedTeams.includes(team));
  if (!bothLocked) {
    return ok({ ...state, guesses, lockedTeams }, events);
  }

  // Second lock just landed — reveal now (see types.ts's top comment on
  // why this is computed here, not via a separate host action or timer).
  const computed = computeRoundResult(state, guesses);
  if (!computed.ok) return err(computed.error.code, computed.error.message);
  events.push(...computed.events);

  const revealedState: GeoGuessrState = {
    ...state,
    phase: "revealed",
    guesses,
    lockedTeams,
    roundResult: computed.result,
    history: [...state.history, computed.result],
    scores: computed.scores,
  };
  return finishOrContinue(revealedState, events);
}

/**
 * The shared reveal math — target + distances + round winner + the
 * score bump if anyone won it — used by BOTH the ordinary "both teams
 * just locked" path (applyLockGuess, always both real guesses) and the
 * countdown-forced path (resolveExpiredCountdown, where a team that
 * never even had an open proposal ends up with a genuine `null` guess —
 * see GeoRoundResult's own doc comment). A `null` guess always loses to
 * a real one; two `null`s is a TIE with no score change, same "nobody
 * answered" shape as BoardQuestionEngine's own no-correct-answer close.
 */
function computeRoundResult(
  state: GeoGuessrState,
  guesses: Record<TeamRole, GeoGuess | null>,
): { ok: true; result: GeoRoundResult; scores: Scoreboard; events: GeoGuessrEvent[] } | { ok: false; error: { code: "ROUND_NOT_FOUND"; message: string } } {
  const round = state.rounds[state.currentRoundIndex];
  // `targetX`/`targetY` are only ever `null` in a REDACTED view
  // (view.ts) — `apply` always runs against real, full, host-eyes state
  // (never fed a redacted one back in), and geoGuessrConfigSchema
  // requires both on every round at game creation. Still guarded, not
  // asserted, so a genuinely malformed state fails with a real error
  // instead of a crash or silently wrong distance math.
  if (!round || round.targetX === null || round.targetY === null) {
    return { ok: false, error: { code: "ROUND_NOT_FOUND", message: "The active round no longer exists." } };
  }
  const target = { targetX: round.targetX, targetY: round.targetY }; // narrowed to non-null numbers, unlike `round` itself

  const distances: Record<TeamRole, number | null> = {
    TEAM_A: guesses.TEAM_A ? distanceTo(guesses.TEAM_A, target) : null,
    TEAM_B: guesses.TEAM_B ? distanceTo(guesses.TEAM_B, target) : null,
  };
  const roundWinner = closerTeam(distances);
  const result: GeoRoundResult = { roundIndex: state.currentRoundIndex, targetX: target.targetX, targetY: target.targetY, guesses, distances, roundWinner };
  const events: GeoGuessrEvent[] = [{ type: "ROUND_REVEALED", result }];

  let scores: Scoreboard = state.scores;
  if (roundWinner !== "TIE") {
    scores = addScore(scores, roundWinner, 1);
    events.push(scoreChangedEvent(roundWinner, 1, scores));
  }

  return { ok: true, result, scores, events };
}

/**
 * Once a round is genuinely revealed (whether naturally, via
 * applyLockGuess, or forced by an expired countdown), decides what
 * happens next: first-to-GEO_WIN_THRESHOLD or the board's last round
 * just played both mean the game is over now — same "decide
 * immediately, don't wait for a further action" shape as
 * BoardQuestionEngine's finishIfBoardComplete. Otherwise the round just
 * stays revealed, waiting for NEXT_ROUND (or its own still-ticking
 * countdown — see resolveExpiredCountdown's own doc comment on why a
 * countdown deliberately survives a NATURAL early reveal).
 */
function finishOrContinue(state: GeoGuessrState, events: GeoGuessrEvent[]): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  const reachedThreshold = checkFirstToN(state.scores, GEO_WIN_THRESHOLD).length > 0;
  const noMoreRounds = state.currentRoundIndex >= state.rounds.length - 1;
  if (reachedThreshold || noMoreRounds) {
    const winner = leadingTeam(state.scores) ?? "TIE";
    // countdownDeadline cleared too — a finish is a finish regardless of
    // what triggered it; a Host-started countdown that never got the
    // chance to expire shouldn't linger in state (see finishGameNow's
    // identical clearing).
    return ok({ ...state, status: "finished", winner, countdownDeadline: null }, [...events, gameFinishedEvent(winner, state.scores)]);
  }
  return ok(state, events);
}

function applyNextRound(state: GeoGuessrState, by: ParticipantRole): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host advances to the next round.");
  if (state.phase !== "revealed") {
    return err("WRONG_PHASE", `Cannot advance rounds during phase "${state.phase}".`);
  }
  const nextIndex = state.currentRoundIndex + 1;
  if (nextIndex >= state.rounds.length) {
    // Defensive: applyLockGuess already finishes the game once the last
    // round is revealed, so this shouldn't normally be reachable.
    return err("NO_ROUNDS_REMAINING", "There are no more rounds to play.");
  }

  const nextState: GeoGuessrState = {
    ...state,
    phase: "guessing",
    currentRoundIndex: nextIndex,
    proposals: { TEAM_A: [], TEAM_B: [] },
    guesses: { TEAM_A: null, TEAM_B: null },
    lockedTeams: [],
    roundResult: null,
    // A fresh round always starts countdown-free — whatever was ticking
    // for the OLD round no longer means anything once the Host has
    // chosen to move on themselves; they start a new one if they want
    // one. Same clearing the countdown's own AUTOMATIC advance does
    // (resolveExpiredCountdown) — manual and automatic advance always
    // leave a round in the identical countdown-free state.
    countdownDeadline: null,
  };
  return ok(nextState, [{ type: "ROUND_ADVANCED", roundIndex: nextIndex }]);
}

/**
 * The one real "stop now" transition — highest current score wins, "TIE"
 * if level, whatever round was in progress is simply abandoned, any
 * countdown is cleared (a finished game never shows a stale one). Shared
 * by THREE callers that all mean exactly this, byte-identically: the
 * Host's own END_GAME action, a countdown expiring on its own
 * (`checkExpiry`), and — indirectly — the server's real-time countdown
 * timer (src/server/sockets/game.ts), which just re-dispatches a plain
 * END_GAME action rather than inventing a fourth code path. Not
 * `applyEndGame` itself: that one still owns the HOST-only role check,
 * which an EXPIRED-deadline auto-resolution has no "acting role" to
 * check in the first place (see `checkExpiry`'s own doc comment).
 */
function finishGameNow(state: GeoGuessrState): GeoGuessrState {
  const winner = leadingTeam(state.scores) ?? "TIE";
  return {
    ...state,
    status: "finished",
    phase: "guessing",
    proposals: { TEAM_A: [], TEAM_B: [] },
    guesses: { TEAM_A: null, TEAM_B: null },
    lockedTeams: [],
    winner,
    countdownDeadline: null,
  };
}

/** Host stopping the game early — same rule as BoardQuestionEngine's applyEndGame: highest current score wins, "TIE" if level. Whatever round was in progress is simply abandoned. */
function applyEndGame(state: GeoGuessrState, by: ParticipantRole): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can end the game.");
  // Computed once, up front, rather than read back off `nextState.winner`
  // (typed as `TeamRole | "TIE" | null` since that field is `null`
  // whenever the game's still in progress) — finishGameNow always sets a
  // real one, but this keeps that fact visible to the type checker too.
  const winner = leadingTeam(state.scores) ?? "TIE";
  const nextState = finishGameNow(state);
  return ok(nextState, [gameFinishedEvent(winner, state.scores)]);
}

/**
 * Starts (or RETARGETS, if one's already running — a Host who clicks
 * 30s then decides 10s just gets the new deadline, no separate cancel
 * step required) a countdown that force-resolves the CURRENT round once
 * it expires (see `resolveExpiredCountdown`'s own doc comment — NOT
 * "ends the whole game" any more). Any phase, only gated on the
 * top-level "not already finished" check in `apply`. `nowMs` is
 * server-injected, never client-controlled (this action's own schema
 * doc comment) — a client can't shorten/extend its own deadline by
 * lying about the current time.
 */
function applyStartCountdown(state: GeoGuessrState, by: ParticipantRole, durationMs: CountdownDurationMs, nowMs: number): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can start a countdown.");
  const deadlineMs = computeDeadline(nowMs, durationMs);
  return ok({ ...state, countdownDeadline: deadlineMs }, [{ type: "COUNTDOWN_STARTED", deadlineMs }]);
}

/** Cancels a running countdown outright — no replacement, the game just keeps going with no deadline. */
function applyCancelCountdown(state: GeoGuessrState, by: ParticipantRole): EngineResult<GeoGuessrState, GeoGuessrEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can cancel a countdown.");
  if (state.countdownDeadline === null) return err("NO_COUNTDOWN_ACTIVE", "There's no countdown running to cancel.");
  return ok({ ...state, countdownDeadline: null }, [{ type: "COUNTDOWN_CANCELLED" }]);
}

/**
 * What COUNTDOWN_EXPIRED actually means for GeoGuessr — a real product
 * decision, not "always ends the whole game" (the OLD behavior — see
 * this file's git history and countdownDeadline's own doc comment in
 * types.ts). The ask was explicit: the countdown governs the CURRENT
 * round, forcing it closed and moving on to the next one, or ending the
 * game outright only if this was the last round.
 *
 *   1. Still `guessing`? Force the round closed: any team that hasn't
 *      locked yet but DOES have an open proposal gets that proposal
 *      (their own newest one — same "tap again replaces" convention
 *      SET_GUESS already uses) auto-locked, exactly as if they'd
 *      clicked "Lock this spot" themselves the instant before the
 *      buzzer. A team with genuinely ZERO proposals queued gets no
 *      guess at all — a real "didn't even attempt this round," not a
 *      guess this function invents. Then reveals via the SAME
 *      `computeRoundResult` an ordinary both-locked reveal uses (it
 *      already tolerates a missing guess — see GeoRoundResult's own
 *      doc comment).
 *   2. Already `revealed` (both teams locked naturally before the
 *      deadline, Host just hadn't clicked NEXT_ROUND yet)? Nothing to
 *      force-lock — skip straight to step 3. This is WHY a countdown
 *      deliberately survives a natural early reveal instead of being
 *      cleared by it (types.ts's own doc comment): the deadline is a
 *      real cap on how long this round gets, total, not just a
 *      "if nobody's answered yet" fallback.
 *   3. Decide what's next, via the SAME `finishOrContinue` an ordinary
 *      reveal already uses: first-to-GEO_WIN_THRESHOLD or the last
 *      round just played both finish the game now; otherwise advance
 *      straight to the next round — genuinely straight to it, no
 *      waiting for a Host click, which is the literal ask ("le
 *      compteur du round fini le round et nous envoie au prochain
 *      round").
 */
function resolveExpiredCountdown(state: GeoGuessrState): { state: GeoGuessrState; events: GeoGuessrEvent[] } {
  let working = state;
  const events: GeoGuessrEvent[] = [];

  if (working.phase === "guessing") {
    let guesses = working.guesses;
    let lockedTeams = working.lockedTeams;
    for (const team of TEAM_ROLES) {
      if (lockedTeams.includes(team)) continue;
      const proposals = working.proposals[team];
      const latest = proposals[proposals.length - 1];
      if (!latest) continue; // genuinely never proposed anything this round — stays unlocked/no-guess
      guesses = { ...guesses, [team]: { x: latest.x, y: latest.y } };
      lockedTeams = [...lockedTeams, team];
      events.push({ type: "TEAM_LOCKED", team });
    }
    working = { ...working, guesses, lockedTeams };

    const computed = computeRoundResult(working, guesses);
    if (computed.ok) {
      events.push(...computed.events);
      working = { ...working, phase: "revealed", roundResult: computed.result, history: [...working.history, computed.result], scores: computed.scores };
    }
    // `computed.ok === false` means ROUND_NOT_FOUND — a genuinely
    // malformed state (the active round vanished from `rounds`, which
    // nothing in this engine can otherwise produce). Falls through to
    // step 3 below anyway rather than getting stuck: there's no
    // meaningful reveal to show, but the show still has to move on.
  }

  const decided = finishOrContinue(working, events);
  if (!decided.ok) {
    // Unreachable in practice (finishOrContinue never itself fails —
    // it only ever calls `ok`) but keeps this function total rather
    // than silently swallowing a hypothetical future error path.
    return { state: working, events };
  }
  if (decided.state.status === "finished") return { state: decided.state, events: decided.events };

  // Not finishing — genuinely advance to the next round, the literal
  // "nous envoie au prochain round" ask, no NEXT_ROUND click required.
  const nextIndex = decided.state.currentRoundIndex + 1;
  const advanced: GeoGuessrState = {
    ...decided.state,
    phase: "guessing",
    currentRoundIndex: nextIndex,
    proposals: { TEAM_A: [], TEAM_B: [] },
    guesses: { TEAM_A: null, TEAM_B: null },
    lockedTeams: [],
    roundResult: null,
    countdownDeadline: null,
  };
  return { state: advanced, events: [...decided.events, { type: "ROUND_ADVANCED", roundIndex: nextIndex }] };
}

/**
 * The pure "did the countdown run out?" resolution — kernel.ts's
 * `checkExpiry` hook, called by the server (src/server/game/service.ts's
 * `getCurrentGame`) with a real `nowMs`, OUTSIDE `apply()` (which can
 * never read the wall clock — kernel.ts's own top rule). This is the
 * SAFETY-NET path, not the primary one: under normal operation, the
 * server's own real-time countdown timer (game.ts) fires and
 * re-dispatches a plain COUNTDOWN_EXPIRED action through the ordinary
 * `apply()` path the instant the deadline passes, so every connected
 * client gets a real-time broadcast. This function exists for when that
 * in-process timer was lost (a server restart, or — very real for this
 * project's own `pnpm dev`, which runs `tsx watch` — a hot reload
 * mid-countdown): the NEXT time anything reads this game's state (a
 * reconnect, a poll, any other action), it self-heals instead of
 * leaving a permanently stuck "0:00 remaining" nobody ever resolves. No
 * "acting role" to check here (nothing a participant did triggered this
 * — the deadline itself did), so this reuses `resolveExpiredCountdown`
 * directly, discarding its events (this hook can only ever return
 * state — see kernel.ts's own `checkExpiry` doc comment).
 */
export function checkExpiry(state: GeoGuessrState, nowMs: number): GeoGuessrState | null {
  if (state.status === "finished") return null;
  if (state.countdownDeadline === null) return null;
  if (!isExpired(state.countdownDeadline, nowMs)) return null;
  return resolveExpiredCountdown(state).state;
}

function distanceTo(guess: GeoGuess, round: { targetX: number; targetY: number }): number {
  return Math.hypot(guess.x - round.targetX, guess.y - round.targetY);
}

/** Lower distance wins — the inverse comparison of scoring.ts's leadingTeam (higher wins), so not reused directly; GeoGuessr-specific on purpose. A `null` distance (see GeoRoundResult's own doc comment — only reachable via a countdown-forced close) always loses to a real one; two `null`s is a TIE. */
function closerTeam(distances: Record<TeamRole, number | null>): TeamRole | "TIE" {
  const [a, b] = TEAM_ROLES;
  const da = distances[a];
  const db = distances[b];
  if (da === null && db === null) return "TIE";
  if (da === null) return b;
  if (db === null) return a;
  if (da === db) return "TIE";
  return da < db ? a : b;
}

export function availableActions(state: GeoGuessrState, role: ParticipantRole): string[] {
  if (state.status === "finished") return [];
  // START_COUNTDOWN is offered any time END_GAME is (same "any phase"
  // posture, since it's just a delayed END_GAME) — CANCEL_COUNTDOWN only
  // once one is actually running, same "nothing to do otherwise" shape
  // NEXT_ROUND/LOCK_GUESS already use elsewhere in this function.
  const hostCanAlwaysEnd = role === "HOST" ? ["END_GAME", "START_COUNTDOWN", ...(state.countdownDeadline !== null ? ["CANCEL_COUNTDOWN"] : [])] : [];
  if (role === "HOST") {
    return state.phase === "revealed" ? ["NEXT_ROUND", ...hostCanAlwaysEnd] : [...hostCanAlwaysEnd];
  }
  if (!isTeamRole(role)) return []; // DISPLAY never acts
  if (state.phase !== "guessing" || state.lockedTeams.includes(role)) return [];
  return state.proposals[role].length > 0 ? ["SET_GUESS", "LOCK_GUESS"] : ["SET_GUESS"];
}

export const geoGuessrEngine: GameEngine<GeoGuessrState, GeoGuessrAction, GeoGuessrEvent, GeoGuessrConfig> = {
  id: "geoguessr",
  label: "GeoGuessr",
  description: "Two teams, one map — place your guess, lock it in, closest to the target wins the round.",
  meta: "2 teams · map guessing",
  hasContentStudio: true,
  createInitialState,
  apply,
  availableActions,
  toPublicView,
  checkExpiry,
  getWinner: (state) => (state.status === "finished" ? state.winner : null),
};
