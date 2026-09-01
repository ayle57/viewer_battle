"use client";

import { useState } from "react";
import type { GuessThePriceState } from "@/domain/game/guessThePrice";
import { BuzzButton, ImageWithFallback } from "@/ui";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { BuzzImpact } from "@/app/_shared/boardQuestion/BuzzImpact";
import { describeLastResult, lastJudgment } from "./events";
import { readableGuessThePriceError } from "./gameErrorMessages";
import { PriceGuessInput } from "./PriceGuessInput";
import styles from "./PlayerPricePanel.module.css";

export interface PlayerPricePanelProps {
  state: GuessThePriceState;
  role: "TEAM_A" | "TEAM_B";
  lastEvents: unknown[];
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

function formatPrice(price: number): string {
  return `€${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The player's view — same buzzer-race shape as MusicEngine's own
 * PlayerMusicPanel (BUZZ -> a real typed answer -> a big CORRECT/
 * INCORRECT beat), with `PriceGuessInput` standing in for MusicEngine's
 * free-text `AnswerInput` — a float, not a title/artist guess ("ça peut
 * être un float"). Genuinely different from SteamRatingsEngine (this
 * engine's first pass): the item itself (`round.title`/`round.imageUrl`)
 * is ALWAYS public from the moment a round starts — there's no
 * progressive reveal to render, only the PRICE is secret, shown here as
 * a "???" placeholder until `phase === "revealed"`.
 */
export function PlayerPricePanel({ state, role, lastEvents, sendAction }: PlayerPricePanelProps) {
  const [buzzing, setBuzzing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  async function buzz() {
    setBuzzing(true);
    setError(null);
    const result = await sendAction({ type: "BUZZ" });
    if (!result.ok && result.error) setError(result.error);
    setBuzzing(false);
  }

  async function submitGuess(guess: number) {
    setSubmitting(true);
    setError(null);
    const result = await sendAction({ type: "SUBMIT_ANSWER", guess });
    if (!result.ok && result.error) setError(result.error);
    setSubmitting(false);
  }

  const round = state.rounds[state.currentRoundIndex];
  const judgment = state.buzzedTeam === null ? lastJudgment(lastEvents) : null; // only show it once the floor has actually moved on
  const otherResult = !judgment ? describeLastResult(lastEvents) : null;
  const variant = role === "TEAM_A" ? "teamA" : "teamB";
  const otherTeam = role === "TEAM_A" ? "TEAM_B" : "TEAM_A";

  const canBuzz = state.phase === "guessing" && !state.attemptedTeams.includes(role);
  const isSteal = state.attemptedTeams.length > 0;
  const otherTeamAlreadyOut = state.attemptedTeams.includes(otherTeam);
  const myTeamAlreadyOut = state.attemptedTeams.includes(role) && state.buzzedTeam !== role;
  const itsMyTurn = state.buzzedTeam === role;
  const iSubmitted = itsMyTurn && state.submittedGuess !== null;
  const revealed = state.phase === "revealed";

  return (
    <div className={styles.wrap}>
      <div className={styles.scoreLine}>
        <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} />
      </div>

      <p className={styles.roundLabel}>
        ITEM {state.currentRoundIndex + 1} / {state.rounds.length}
      </p>

      {error && <p className={styles.errorBanner}>{readableGuessThePriceError(error.code, error.message)}</p>}
      {!error && judgment && (
        <p className={[styles.judgmentBanner, judgment.correct ? styles.correct : styles.incorrect].join(" ")}>{judgment.correct ? "CORRECT" : "INCORRECT"}</p>
      )}
      {!error && !judgment && otherResult && <p className={styles.resultBanner}>{otherResult}</p>}

      {round && (
        <div className={styles.playerArea}>
          <div className={styles.itemBlock}>
            {round.imageUrl && <ImageWithFallback src={round.imageUrl} alt="" className={styles.itemImage} />}
            <p className={styles.itemTitle}>{round.title}</p>
            <p className={styles.priceValue}>{revealed && round.price !== null ? formatPrice(round.price) : "???"}</p>
          </div>

          <div className={styles.buzzArea}>
            {itsMyTurn && (
              <BuzzImpact team={role}>
                <>
                  {!iSubmitted && (
                    <>
                      <p className={[styles.statusLine, styles.myTurn].join(" ")}>YOU BUZZED</p>
                      <p className={styles.answerLabel}>Your price guess</p>
                    </>
                  )}
                  <PriceGuessInput onSubmit={(guess) => void submitGuess(guess)} pending={submitting} submitted={iSubmitted} submitLabel="SEND GUESS" />
                  {iSubmitted && <p className={styles.statusLine}>GUESS SENT</p>}
                </>
              </BuzzImpact>
            )}

            {state.buzzedTeam && !itsMyTurn && (
              <BuzzImpact team={state.buzzedTeam}>
                <div className={styles.otherTeamAnswering}>
                  <p className={styles.statusLine}>{TEAM_LABEL[state.buzzedTeam]} IS ANSWERING</p>
                  {state.submittedGuess !== null && <p className={styles.theirGuess}>{formatPrice(state.submittedGuess)}</p>}
                </div>
              </BuzzImpact>
            )}

            {!state.buzzedTeam && canBuzz && (
              <>
                <p className={styles.statusLine}>{isSteal ? "YOU CAN STEAL" : "Gotta be quick!"}</p>
                <BuzzButton variant={variant} pending={buzzing} onClick={() => void buzz()} />
              </>
            )}

            {!state.buzzedTeam && !canBuzz && !revealed && myTeamAlreadyOut && !otherTeamAlreadyOut && (
              <p className={styles.statusLine}>You already buzzed — {TEAM_LABEL[otherTeam]} can steal now.</p>
            )}
            {!state.buzzedTeam && !canBuzz && !revealed && myTeamAlreadyOut && otherTeamAlreadyOut && <p className={styles.statusLine}>Both teams have tried this item.</p>}
            {revealed && <p className={styles.statusLine}>Waiting for the Host to continue…</p>}
          </div>
        </div>
      )}

      {!round && <p className={styles.statusLine}>{state.status === "finished" ? "Game finished." : "Waiting for the next item…"}</p>}
    </div>
  );
}
