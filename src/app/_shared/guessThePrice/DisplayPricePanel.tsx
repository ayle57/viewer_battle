"use client";

import type { GuessThePriceState } from "@/domain/game/guessThePrice";
import { Card, CardBody, ImageWithFallback } from "@/ui";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { BuzzImpact } from "@/app/_shared/boardQuestion/BuzzImpact";
import { describeLastResult, lastJudgment } from "./events";
import styles from "./DisplayPricePanel.module.css";

export interface DisplayPricePanelProps {
  state: GuessThePriceState;
  lastEvents: unknown[];
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

function formatPrice(price: number): string {
  return `€${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Read-only, built for OBS capture — no `sendAction` prop, same posture
 * as DisplayBoardPanel.tsx / DisplaySteamPanel.tsx. This is the screen
 * an audience actually watches: the item (photo + title, public the
 * whole time this round is live) with its price shown as a "???"
 * placeholder until `phase === "revealed"`, at which point the real
 * price replaces it — this game's own reveal beat, the counterpart to
 * SteamRatingsEngine's own "that was: X" moment. Every entrance
 * flourish beyond that (a wipe, a sting, a sound cue) is deliberately
 * left to the Host's own OBS layering on top of this state, not built
 * here — see HostPricePanel.tsx's own doc comment.
 */
export function DisplayPricePanel({ state, lastEvents }: DisplayPricePanelProps) {
  const round = state.rounds[state.currentRoundIndex];
  const judgment = state.buzzedTeam === null ? lastJudgment(lastEvents) : null;
  const lastResult = !judgment ? describeLastResult(lastEvents) : null;
  const teamClass = state.buzzedTeam === "TEAM_A" ? styles.buzzedTeamA : styles.buzzedTeamB;
  const finishedClass = state.winner === "TEAM_A" ? styles.finishedA : state.winner === "TEAM_B" ? styles.finishedB : undefined;
  const revealed = state.phase === "revealed";

  return (
    <div className={styles.wrap}>
      <Card variant="raised" className={styles.scoreCard}>
        <CardBody>
          <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} size="lg" />
        </CardBody>
      </Card>

      {state.status === "finished" && (
        <p className={[styles.finishedBanner, finishedClass].filter(Boolean).join(" ")}>
          {state.winner === "TIE" ? "IT'S A TIE" : (
            <>
              <span aria-hidden="true">🏆</span> {TEAM_LABEL[state.winner as "TEAM_A" | "TEAM_B"]} WINS
            </>
          )}
        </p>
      )}

      {round && (
        <Card variant="raised" key={state.currentRoundIndex} className={styles.gameEnter}>
          <CardBody>
            <div className={styles.itemBlock}>
              {round.imageUrl && <ImageWithFallback src={round.imageUrl} alt="" className={styles.itemImage} />}
              <p className={styles.itemTitle}>{round.title}</p>
              <p className={[styles.priceValue, revealed && styles.priceRevealed].filter(Boolean).join(" ")}>
                {revealed && round.price !== null ? formatPrice(round.price) : "???"}
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {state.buzzedTeam && (
        <BuzzImpact team={state.buzzedTeam}>
          <div className={styles.buzzedBlock}>
            <p className={[styles.buzzedBanner, teamClass].join(" ")}>{TEAM_LABEL[state.buzzedTeam]} IS ANSWERING</p>
            {state.submittedGuess !== null && <p className={styles.submittedGuess}>{formatPrice(state.submittedGuess)}</p>}
          </div>
        </BuzzImpact>
      )}

      {!state.buzzedTeam && judgment && (
        <p className={[styles.judgmentBanner, judgment.correct ? styles.correct : styles.incorrect].join(" ")}>{judgment.correct ? "CORRECT" : "INCORRECT"}</p>
      )}
      {!state.buzzedTeam && !judgment && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

      {!round && state.status === "in_progress" && <p className={styles.statusLine}>Waiting for the next item…</p>}
    </div>
  );
}
