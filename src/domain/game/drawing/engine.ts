import { isTeamRole, TEAM_ROLES, type ParticipantRole, type TeamRole } from "@/domain/session";
import { err, ok, type EngineResult, type GameEngine } from "../kernel";
import { addScore, checkFirstToN, leadingTeam } from "../scoring";
import { gameFinishedEvent, scoreChangedEvent } from "../events";
import { computeDeadline, isExpired } from "../timer";
import {
  drawingActionSchema,
  drawingConfigSchema,
  type DrawingAction,
  type DrawingConfig,
  type DrawingEvent,
  type DrawingState,
} from "./types";
import { toPublicView } from "./view";

/** FIRST TO 6 round-wins takes the match — the product's stated win condition (see types.ts's top comment). Not configurable per game start; a real rule, not a magic number — same posture as GeoGuessr's own GEO_WIN_THRESHOLD. */
export const DRAWING_WIN_THRESHOLD = 6;

export function createInitialState(config: DrawingConfig): DrawingState {
  const parsed = drawingConfigSchema.parse(config);
  return {
    status: "in_progress",
    phase: "choosing_drawer",
    prompts: parsed.prompts,
    currentPromptIndex: 0,
    activeTeam: "TEAM_A",
    drawerName: null,
    countdownDeadline: null,
    scores: { TEAM_A: 0, TEAM_B: 0 },
    winner: null,
    history: [],
  };
}

export function apply(state: DrawingState, action: DrawingAction): EngineResult<DrawingState, DrawingEvent> {
  // Re-validated regardless of the static type — see kernel.ts: `action`
  // is what a socket/tRPC handler decoded from untrusted JSON.
  const parsed = drawingActionSchema.safeParse(action);
  if (!parsed.success) {
    return err("INVALID_ACTION", parsed.error.issues[0]?.message ?? "Invalid action");
  }
  const validated = parsed.data;

  if (state.status === "finished") {
    return err("GAME_ALREADY_FINISHED", "This game has already finished.");
  }

  switch (validated.type) {
    case "CHOOSE_DRAWER":
      return applyChooseDrawer(state, validated.by, validated.byName, validated.nowMs);
    case "JUDGE_GUESS":
      return applyJudgeGuess(state, validated.by, validated.correct);
    case "NEXT_PROMPT":
      return applyNextPrompt(state, validated.by);
    case "SKIP_TURN":
      return applySkipTurn(state, validated.by);
    case "ADJUST_COUNTDOWN":
      return applyAdjustCountdown(state, validated.by, validated.deltaSeconds, validated.nowMs);
    case "COUNTDOWN_EXPIRED":
      return resolveExpiredCountdown(state);
    case "END_GAME":
      return applyEndGame(state, validated.by);
  }
}

/**
 * Either player on the ACTIVE team may claim the draw — first valid claim
 * wins (a race, same shape as BoardQuestionEngine's applyBuzz: whichever
 * team member's action the engine receives first is the one who gets it,
 * a second attempt just lands in the now-wrong phase and is rejected).
 * `nowMs` is server-injected the same way GeoGuessr's START_COUNTDOWN's
 * is (src/server/sockets/game.ts) — never client-controlled, so a client
 * can't manipulate the round's own deadline by lying about the current
 * time. The countdown is computed from THIS prompt's own
 * `durationSeconds` (author-configured in Content Studio), not a
 * host-picked live value — see types.ts's top comment on why this
 * doesn't reuse ../countdown's own START_COUNTDOWN action.
 */
function applyChooseDrawer(state: DrawingState, by: ParticipantRole, byName: string, nowMs: number): EngineResult<DrawingState, DrawingEvent> {
  if (!isTeamRole(by)) return err("FORBIDDEN_ROLE", "Only a team may choose who draws.");
  if (by !== state.activeTeam) return err("FORBIDDEN_ROLE", `It's ${state.activeTeam}'s turn to draw, not ${by}'s.`);
  if (state.phase !== "choosing_drawer") {
    return err("WRONG_PHASE", `Cannot choose a drawer during phase "${state.phase}".`);
  }
  const prompt = state.prompts[state.currentPromptIndex];
  if (!prompt) return err("WRONG_PHASE", "No prompt is available for this turn.");

  const deadlineMs = computeDeadline(nowMs, prompt.durationSeconds * 1000);
  const nextState: DrawingState = { ...state, phase: "drawing", drawerName: byName, countdownDeadline: deadlineMs };
  return ok(nextState, [
    { type: "DRAWER_CHOSEN", team: by, drawerName: byName },
    { type: "COUNTDOWN_STARTED", deadlineMs },
  ]);
}

/**
 * Host nudges the running drawing countdown up or down — same "RETARGET,
 * don't invent a second timer" posture GeoGuessr's own applyStartCountdown
 * already established: this just emits another `COUNTDOWN_STARTED` with a
 * new `deadlineMs`, which the existing, unmodified `scheduleCountdownIfAny`/
 * gameEndTimers.ts machinery (src/server/sockets/game.ts) picks up and
 * reschedules for free (`scheduleGameEndTimer` always cancels any prior
 * timer for this game before setting the new one). Clamped so a Host
 * removing more time than remains still lands at least 1s in the future —
 * a zero/negative deadline would race the real-time timer's own delay
 * calculation (`remainingMs`) rather than cleanly resolving through the
 * ordinary COUNTDOWN_EXPIRED path.
 */
const MIN_ADJUSTED_REMAINING_MS = 1000;

function applyAdjustCountdown(state: DrawingState, by: ParticipantRole, deltaSeconds: number, nowMs: number): EngineResult<DrawingState, DrawingEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can adjust the timer.");
  if (state.phase !== "drawing" || state.countdownDeadline === null) {
    return err("NO_COUNTDOWN_ACTIVE", "There's no drawing countdown running to adjust.");
  }
  const deadlineMs = Math.max(nowMs + MIN_ADJUSTED_REMAINING_MS, state.countdownDeadline + deltaSeconds * 1000);
  return ok({ ...state, countdownDeadline: deadlineMs }, [{ type: "COUNTDOWN_STARTED", deadlineMs }]);
}

/**
 * The host judges the guess the (silent, out-loud) guesser just made —
 * same posture as BoardQuestionEngine's applyJudgeAnswer. Correct awards
 * the ACTIVE team a point; incorrect awards it to the OTHER team
 * automatically (the cahier's literal rule: the other team never has to
 * do anything to earn it — no steal mechanic here, unlike Jeopardy).
 * Moves to "resolved" — a real reaction beat, same shape as GeoGuessr's
 * own "guessing" -> "revealed" — rather than cutting straight to the
 * next turn; NEXT_PROMPT is what actually advances it (see types.ts's
 * top comment for the full "why a pause" reasoning, and this file's own
 * git history for the real Host complaint this fixed: judging used to
 * instantly swap in the next team's own prompt with zero time to react).
 */
function applyJudgeGuess(state: DrawingState, by: ParticipantRole, correct: boolean): EngineResult<DrawingState, DrawingEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host judges a guess.");
  if (state.phase !== "guessing" || !state.drawerName) {
    return err("WRONG_PHASE", `Cannot judge a guess during phase "${state.phase}".`);
  }
  const prompt = state.prompts[state.currentPromptIndex];
  if (!prompt) return err("WRONG_PHASE", "No prompt is active for this turn.");

  const winningTeam = correct ? state.activeTeam : otherTeam(state.activeTeam);
  const scores = addScore(state.scores, winningTeam, 1);
  const events: DrawingEvent[] = [
    { type: "GUESS_JUDGED", team: state.activeTeam, correct },
    scoreChangedEvent(winningTeam, 1, scores),
  ];

  const resolvedState: DrawingState = {
    ...state,
    phase: "resolved",
    scores,
    history: [...state.history, { promptId: prompt.id, promptText: prompt.text, team: state.activeTeam, drawerName: state.drawerName, correct }],
  };
  return finishOrPause(resolvedState, events);
}

/**
 * Host escape hatch — "this prompt isn't working out," closes the turn
 * with no winner, no score change either way. Legal from any phase
 * before "resolved" — including "choosing_drawer" (nobody's even drawn
 * yet), hence `drawerName` staying whatever it already was (`null` if
 * skipped that early) rather than being required. Reuses the SAME
 * "resolved" pause a judged turn goes through (finishOrPause) instead of
 * an instant second advance path — the Host still gets a beat to see
 * "this one was skipped" before NEXT_PROMPT, and alternation/scoring stay
 * governed by the exact same code either way. Cancels an in-progress
 * drawing countdown out from under it (COUNTDOWN_CANCELLED) so the
 * real-time timer (gameEndTimers.ts) doesn't fire stale for a turn that's
 * already moved on — the resolved state's own `countdownDeadline: null`
 * already makes a late COUNTDOWN_EXPIRED a harmless no-op (`resolveExpiredCountdown`
 * only ever acts during "drawing"), but emitting the event lets the
 * server actually clear the pending Node timer instead of just leaving a
 * dead one to fire later.
 */
function applySkipTurn(state: DrawingState, by: ParticipantRole): EngineResult<DrawingState, DrawingEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can skip a turn.");
  if (state.phase === "resolved") {
    return err("WRONG_PHASE", `Cannot skip a turn during phase "${state.phase}".`);
  }
  const prompt = state.prompts[state.currentPromptIndex];
  if (!prompt) return err("WRONG_PHASE", "No prompt is active for this turn.");

  const events: DrawingEvent[] = [{ type: "TURN_SKIPPED", team: state.activeTeam }];
  if (state.countdownDeadline !== null) events.push({ type: "COUNTDOWN_CANCELLED" });

  const resolvedState: DrawingState = {
    ...state,
    phase: "resolved",
    countdownDeadline: null,
    history: [...state.history, { promptId: prompt.id, promptText: prompt.text, team: state.activeTeam, drawerName: state.drawerName, correct: null }],
  };
  return finishOrPause(resolvedState, events);
}

/**
 * Decides what happens once a turn is genuinely "resolved" (judged or
 * skipped): first-to-DRAWING_WIN_THRESHOLD or the playlist's last prompt
 * just being played both mean the match is over now — same "decide
 * immediately, don't wait for a further action" shape as GeoGuessr's own
 * finishOrContinue. Otherwise the turn just stays "resolved", waiting for
 * the Host's own NEXT_PROMPT (applyNextPrompt below) — that's the ONE
 * place the team/index actually advance now.
 */
function finishOrPause(state: DrawingState, events: DrawingEvent[]): EngineResult<DrawingState, DrawingEvent> {
  const reachedThreshold = checkFirstToN(state.scores, DRAWING_WIN_THRESHOLD).length > 0;
  const noMorePrompts = state.currentPromptIndex >= state.prompts.length - 1;
  if (reachedThreshold || noMorePrompts) {
    const winner = leadingTeam(state.scores) ?? "TIE";
    return ok({ ...state, status: "finished", winner }, [...events, gameFinishedEvent(winner, state.scores)]);
  }
  return ok(state, events);
}

/**
 * The Host's own pacing action — only legal once a turn is "resolved" —
 * this is what actually moves the turn/index/team forward into a fresh
 * "choosing_drawer", straight back for the OTHER team. Mirrors
 * GeoGuessrEngine's own applyNextRound almost exactly, including the
 * defensive NO_PROMPTS_REMAINING guard (unreachable in practice —
 * finishOrPause already finishes the game once the last prompt is
 * resolved — but keeps this function total rather than silently
 * producing an out-of-range index).
 */
function applyNextPrompt(state: DrawingState, by: ParticipantRole): EngineResult<DrawingState, DrawingEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host advances to the next prompt.");
  if (state.phase !== "resolved") {
    return err("WRONG_PHASE", `Cannot advance to the next prompt during phase "${state.phase}".`);
  }
  const nextIndex = state.currentPromptIndex + 1;
  if (nextIndex >= state.prompts.length) {
    return err("NO_PROMPTS_REMAINING", "There are no more prompts to play.");
  }

  const nextTeam = otherTeam(state.activeTeam);
  const nextState: DrawingState = {
    ...state,
    phase: "choosing_drawer",
    currentPromptIndex: nextIndex,
    activeTeam: nextTeam,
    drawerName: null,
    countdownDeadline: null,
  };
  return ok(nextState, [{ type: "TURN_ADVANCED", promptIndex: nextIndex, activeTeam: nextTeam }]);
}

/**
 * The one real "stop now" transition — highest current score wins, "TIE"
 * if level, whatever turn was in progress is simply abandoned (no
 * `history` entry, as if it never happened), any countdown is cleared.
 * Shared by the Host's own END_GAME action and — indirectly — the
 * server's real-time countdown timer via COUNTDOWN_EXPIRED, same
 * three-caller shape both other engines already use.
 */
function finishGameNow(state: DrawingState): DrawingState {
  const winner = leadingTeam(state.scores) ?? "TIE";
  return { ...state, status: "finished", phase: "guessing", drawerName: null, countdownDeadline: null, winner };
}

function applyEndGame(state: DrawingState, by: ParticipantRole): EngineResult<DrawingState, DrawingEvent> {
  if (by !== "HOST") return err("FORBIDDEN_ROLE", "Only the host can end the game.");
  const winner = leadingTeam(state.scores) ?? "TIE";
  return ok(finishGameNow(state), [gameFinishedEvent(winner, state.scores)]);
}

/**
 * What COUNTDOWN_EXPIRED means for Drawing — the timer only ever governs
 * the "drawing" phase (30/60/90s to draw); once it fires, the round moves
 * straight to "guessing" with no guess forced (unlike GeoGuessr, there is
 * nothing to auto-lock here — a guess is spoken out loud, not submitted,
 * so an expired timer just means "stop drawing, time to guess now," the
 * Host still has to judge it). A countdown firing while ALREADY in
 * "guessing" or "choosing_drawer" (a stale/duplicate dispatch — see
 * checkExpiry's own doc comment) is simply a no-op, same defensive
 * posture as this being the only phase `countdownDeadline` is ever set
 * in.
 */
function resolveExpiredCountdown(state: DrawingState): EngineResult<DrawingState, DrawingEvent> {
  if (state.phase !== "drawing") return ok(state, []);
  return ok({ ...state, phase: "guessing", countdownDeadline: null }, []);
}

/**
 * The pure "did the countdown run out?" resolution — kernel.ts's
 * `checkExpiry` hook, same SAFETY-NET role as both other engines' own
 * (see their identical doc comments for the full reasoning: this is the
 * self-heal path for when the real-time timer was lost — a server
 * restart, or `pnpm dev`'s `tsx watch` hot-reloading mid-countdown — not
 * the primary one).
 */
export function checkExpiry(state: DrawingState, nowMs: number): DrawingState | null {
  if (state.status === "finished") return null;
  if (state.countdownDeadline === null) return null;
  if (!isExpired(state.countdownDeadline, nowMs)) return null;
  const result = resolveExpiredCountdown(state);
  return result.ok ? result.state : null;
}

/** `otherTeam` — the inverse of whichever team is passed in; only two teams ever exist in this app's domain model (TEAM_ROLES). */
function otherTeam(team: TeamRole): TeamRole {
  const [a, b] = TEAM_ROLES;
  return team === a ? b : a;
}

export function availableActions(state: DrawingState, role: ParticipantRole): string[] {
  if (state.status === "finished") return [];
  const hostCanAlwaysEnd = role === "HOST" ? ["END_GAME"] : [];
  const hostCanSkip = role === "HOST" ? ["SKIP_TURN"] : [];
  switch (state.phase) {
    case "choosing_drawer":
      if (isTeamRole(role) && role === state.activeTeam) return ["CHOOSE_DRAWER"];
      return [...hostCanSkip, ...hostCanAlwaysEnd];
    case "drawing":
      return role === "HOST" ? ["ADJUST_COUNTDOWN", ...hostCanSkip, ...hostCanAlwaysEnd] : [...hostCanAlwaysEnd];
    case "guessing":
      return role === "HOST" ? ["JUDGE_GUESS", ...hostCanSkip, ...hostCanAlwaysEnd] : [];
    case "resolved":
      return role === "HOST" ? ["NEXT_PROMPT", ...hostCanAlwaysEnd] : [];
  }
}

export const drawingEngine: GameEngine<DrawingState, DrawingAction, DrawingEvent, DrawingConfig> = {
  id: "drawing",
  label: "Drawing",
  description: "One player draws a secret word, their teammate guesses — the host judges, first to 6 wins.",
  meta: "Timed sketch, teams guess",
  hasContentStudio: true,
  createInitialState,
  apply,
  availableActions,
  toPublicView,
  checkExpiry,
  getWinner: (state) => (state.status === "finished" ? state.winner : null),
};
