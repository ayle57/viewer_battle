"use client";

import { useState } from "react";
import type { SteamRatingsState } from "@/domain/game/steamRatings";
import { BuzzButton, ImageWithFallback } from "@/ui";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { BuzzImpact } from "@/app/_shared/boardQuestion/BuzzImpact";
import { describeLastResult, lastJudgment } from "./events";
import { readableSteamRatingsError } from "./gameErrorMessages";
import styles from "./PlayerSteamPanel.module.css";

export interface PlayerSteamPanelProps {
  state: SteamRatingsState;
  role: "TEAM_A" | "TEAM_B";
  lastEvents: unknown[];
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

/**
 * The player's view — same buzzer-race shape as MusicEngine's own
 * PlayerMusicPanel, but with ORAL answers, not typed ("finalement les
 * reponses du guess the game seront orales" — a deliberate reversal of
 * the first pass's Music-style AnswerInput step, see
 * src/domain/game/steamRatings/types.ts's top comment): buzzing in is
 * this component's whole job, nothing typed ever happens here — the
 * buzzing team just says their guess out loud and waits for the Host's
 * judgment. The other genuinely new thing here: the live,
 * progressively-growing ratings list (`round.ratings`, already sliced to
 * `revealedCount` by `toPublicView` — this component never has to know
 * that, it just renders whatever array it's handed). No independent
 * playback concept the way Music has (nothing to listen to here) — the
 * Host paces every reveal for everyone at once, so Player just watches
 * the same list Display shows.
 */
export function PlayerSteamPanel({ state, role, lastEvents, sendAction }: PlayerSteamPanelProps) {
  const [buzzing, setBuzzing] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  async function buzz() {
    setBuzzing(true);
    setError(null);
    const result = await sendAction({ type: "BUZZ" });
    if (!result.ok && result.error) setError(result.error);
    setBuzzing(false);
  }

  const round = state.rounds[state.currentRoundIndex];
  const judgment = state.buzzedTeam === null ? lastJudgment(lastEvents) : null; // only show it once the floor has actually moved on
  const otherResult = !judgment ? describeLastResult(lastEvents) : null;
  const variant = role === "TEAM_A" ? "teamA" : "teamB";
  const otherTeam = role === "TEAM_A" ? "TEAM_B" : "TEAM_A";

  const canBuzz = state.phase === "guessing" && state.revealedCount > 0 && !state.attemptedTeams.includes(role);
  const isSteal = state.attemptedTeams.length > 0;
  const otherTeamAlreadyOut = state.attemptedTeams.includes(otherTeam);
  const myTeamAlreadyOut = state.attemptedTeams.includes(role) && state.buzzedTeam !== role;
  const itsMyTurn = state.buzzedTeam === role;
  const revealed = state.phase === "revealed";

  return (
    <div className={styles.wrap}>
      <div className={styles.scoreLine}>
        <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} />
      </div>

      <p className={styles.roundLabel}>
        GAME {state.currentRoundIndex + 1} / {state.rounds.length}
      </p>

      {error && <p className={styles.errorBanner}>{readableSteamRatingsError(error.code, error.message)}</p>}
      {!error && judgment && (
        <p className={[styles.judgmentBanner, judgment.correct ? styles.correct : styles.incorrect].join(" ")}>{judgment.correct ? "CORRECT" : "INCORRECT"}</p>
      )}
      {!error && !judgment && otherResult && <p className={styles.resultBanner}>{otherResult}</p>}

      {round && (
        <div className={styles.playerArea}>
          {revealed ? (
            <div className={styles.revealBlock}>
              <p className={styles.revealLabel}>THAT WAS</p>
              {round.imageUrl && <ImageWithFallback src={round.imageUrl} alt="" className={styles.revealImage} />}
              <p className={styles.revealTitle}>{round.title}</p>
            </div>
          ) : (
            <div className={styles.ratingsBlock}>
              {/* A real, reported gap this closes — the audit found NO
                  instruction anywhere telling the player they're guessing
                  a GAME, not a rating (an easy mix-up given the engine's
                  own name). Same imperative-instruction posture as Music's
                  "🎧 Listen, then buzz in when you know it" a few tabs
                  over — this is the equivalent for Steam Ratings. */}
              <p className={styles.ratingsLabel}>🕵️ Guess the game from these reviews</p>
              {round.ratings.length === 0 ? (
                <p className={styles.statusLine}>Waiting for the Host to reveal the first review…</p>
              ) : (
                <ul className={styles.ratingsList}>
                  {round.ratings.map((text, index) => (
                    <li key={index} className={styles.ratingItem}>
                      {text}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className={styles.buzzArea}>
            {itsMyTurn && (
              <BuzzImpact team={role}>
                <>
                  <p className={[styles.statusLine, styles.myTurn].join(" ")}>YOU BUZZED</p>
                  <p className={styles.answerLabel}>Say your guess out loud — the Host is judging it now.</p>
                </>
              </BuzzImpact>
            )}

            {state.buzzedTeam && !itsMyTurn && (
              <BuzzImpact team={state.buzzedTeam}>
                <div className={styles.otherTeamAnswering}>
                  <p className={styles.statusLine}>{TEAM_LABEL[state.buzzedTeam]} IS ANSWERING</p>
                </div>
              </BuzzImpact>
            )}

            {!state.buzzedTeam && canBuzz && (
              <>
                <p className={styles.statusLine}>{isSteal ? "YOU CAN STEAL" : "Gotta be quick!"}</p>
                <BuzzButton variant={variant} pending={buzzing} onClick={() => void buzz()} />
              </>
            )}

            {!state.buzzedTeam && !canBuzz && !revealed && state.revealedCount === 0 && <p className={styles.statusLine}>Waiting for the first review…</p>}
            {!state.buzzedTeam && !canBuzz && !revealed && state.revealedCount > 0 && myTeamAlreadyOut && !otherTeamAlreadyOut && (
              <p className={styles.statusLine}>You already buzzed — {TEAM_LABEL[otherTeam]} can steal now.</p>
            )}
            {!state.buzzedTeam && !canBuzz && !revealed && myTeamAlreadyOut && otherTeamAlreadyOut && <p className={styles.statusLine}>Both teams have tried this game.</p>}
            {revealed && <p className={styles.statusLine}>Waiting for the Host to continue…</p>}
          </div>
        </div>
      )}

      {!round && <p className={styles.statusLine}>{state.status === "finished" ? "Game finished." : "Waiting for the next game…"}</p>}
    </div>
  );
}
