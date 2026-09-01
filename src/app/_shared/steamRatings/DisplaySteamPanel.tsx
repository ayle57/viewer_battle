"use client";

import type { SteamRatingsState } from "@/domain/game/steamRatings";
import { Card, CardBody, ImageWithFallback } from "@/ui";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { BuzzImpact } from "@/app/_shared/boardQuestion/BuzzImpact";
import { describeLastResult, lastJudgment } from "./events";
import styles from "./DisplaySteamPanel.module.css";

export interface DisplaySteamPanelProps {
  state: SteamRatingsState;
  lastEvents: unknown[];
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

/**
 * Read-only, built for OBS capture — no `sendAction` prop, same posture
 * as DisplayBoardPanel.tsx / DisplayMusicPanel.tsx. This is the screen
 * an audience actually watches: the live, progressively-growing ratings
 * list (`round.ratings`, already sliced to `revealedCount` by
 * `toPublicView`), and — the literal "quand il reveal le jeu c'est de
 * mettre une image" ask — the game's own cover art once
 * `phase === "revealed"`. Every entrance flourish beyond "this array
 * just grew by one" (a wipe, a sting, a sound cue) is deliberately left
 * to the Host's own OBS layering on top of this state, not built here —
 * see HostSteamPanel.tsx's own doc comment.
 */
export function DisplaySteamPanel({ state, lastEvents }: DisplaySteamPanelProps) {
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
            {revealed ? (
              <div className={styles.revealBlock}>
                <p className={styles.revealLabel}>THAT WAS</p>
                {round.imageUrl && <ImageWithFallback src={round.imageUrl} alt="" className={styles.revealImage} />}
                <p className={styles.revealTitle}>{round.title}</p>
              </div>
            ) : (
              <>
                {/* Same gap the audit found on the Player side, mirrored
                    here — nothing on this screen ever told the audience
                    what they're watching for. A quiet header, not a new
                    banner: it sits above the reviews the whole time this
                    game is in its guessing phase, whether zero or several
                    reviews are showing yet. */}
                <p className={styles.gameLabel}>🕵️ Guess the game</p>
                {round.ratings.length === 0 ? (
                  <p className={styles.statusLine}>Get ready…</p>
                ) : (
                  <ul className={styles.ratingsList}>
                    {round.ratings.map((text, index) => (
                      <li key={index} className={styles.ratingItem}>
                        {text}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </CardBody>
        </Card>
      )}

      {state.buzzedTeam && (
        <BuzzImpact team={state.buzzedTeam}>
          <div className={styles.buzzedBlock}>
            <p className={[styles.buzzedBanner, teamClass].join(" ")}>{TEAM_LABEL[state.buzzedTeam]} IS ANSWERING</p>
          </div>
        </BuzzImpact>
      )}

      {!state.buzzedTeam && judgment && (
        <p className={[styles.judgmentBanner, judgment.correct ? styles.correct : styles.incorrect].join(" ")}>{judgment.correct ? "CORRECT" : "INCORRECT"}</p>
      )}
      {!state.buzzedTeam && !judgment && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

      {!round && state.status === "in_progress" && <p className={styles.statusLine}>Waiting for the next game…</p>}
    </div>
  );
}
