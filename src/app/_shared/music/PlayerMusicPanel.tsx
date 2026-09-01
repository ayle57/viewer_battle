"use client";

import { useState } from "react";
import type { MusicState } from "@/domain/game/music";
import { AnswerInput, BuzzButton } from "@/ui";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { BuzzImpact } from "@/app/_shared/boardQuestion/BuzzImpact";
import { describeLastResult, lastJudgment } from "./events";
import { readableMusicError } from "./gameErrorMessages";
import styles from "./PlayerMusicPanel.module.css";

export interface PlayerMusicPanelProps {
  state: MusicState;
  role: "TEAM_A" | "TEAM_B";
  lastEvents: unknown[];
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

/**
 * The player's view — same buzzer-race shape as BoardQuestion's own
 * PlayerBoardPanel (BUZZ -> AnswerInput -> a big CORRECT/INCORRECT
 * beat), plus the one thing genuinely new here: a real, independent
 * `<audio controls>` player. Deliberately NOT routed through
 * useSyncedAudio (that hook is Host/Display's own "listen together"
 * mechanism, src/app/_shared/music/useSyncedAudio.ts's own doc comment)
 * — "les joueurs peuvent lancer independamment" was an explicit product
 * decision: each player controls their own playback, replays freely, on
 * their own device, with zero server round-trip per play. The browser's
 * native controls ARE the whole player; no custom UI needed for
 * play/pause/scrub/volume.
 *
 * `round.audioUrl` is empty until this round is actually playable
 * (view.ts's toPublicView — the round stays fully blanked while
 * `phase === "intro"`, same as a genuinely future round), so there's
 * nothing to accidentally let a player hear before the Host's own
 * shared first play.
 */
export function PlayerMusicPanel({ state, role, lastEvents, sendAction }: PlayerMusicPanelProps) {
  const [buzzing, setBuzzing] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  async function buzz() {
    setBuzzing(true);
    setError(null);
    const result = await sendAction({ type: "BUZZ" });
    if (!result.ok && result.error) setError(result.error);
    setBuzzing(false);
  }

  async function submitAnswer(text: string) {
    setAnswering(true);
    setError(null);
    const result = await sendAction({ type: "SUBMIT_ANSWER", text });
    if (!result.ok && result.error) setError(result.error);
    setAnswering(false);
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
  const iSubmitted = itsMyTurn && state.submittedAnswer !== null;
  const revealed = state.phase === "revealed";

  return (
    <div className={styles.wrap}>
      <div className={styles.scoreLine}>
        <AnimatedScoreDisplay teamAName="Team A" teamAScore={state.scores.TEAM_A} teamBName="Team B" teamBScore={state.scores.TEAM_B} />
      </div>

      <p className={styles.roundLabel}>
        TRACK {state.currentRoundIndex + 1} / {state.rounds.length}
      </p>

      {error && <p className={styles.errorBanner}>{readableMusicError(error.code, error.message)}</p>}
      {!error && judgment && (
        <p className={[styles.judgmentBanner, judgment.correct ? styles.correct : styles.incorrect].join(" ")}>{judgment.correct ? "CORRECT" : "INCORRECT"}</p>
      )}
      {!error && !judgment && otherResult && <p className={styles.resultBanner}>{otherResult}</p>}

      {round && (
        <div className={styles.playerArea}>
          {revealed ? (
            <div className={styles.revealBlock}>
              <p className={styles.revealLabel}>THAT WAS</p>
              <p className={styles.revealTitle}>{round.title}</p>
              {round.artist && <p className={styles.revealArtist}>{round.artist}</p>}
            </div>
          ) : round.audioUrl ? (
            <div className={styles.playerBlock}>
              {/* A real, first-time-player gap: nothing told anyone they
                  had to press ▶ themselves — the native player just sat
                  there with zero context. One short caption, same
                  all-caps instructional tone every other "what do I do
                  right now" line on this screen already uses ("Gotta be
                  quick!", "YOU BUZZED"). */}
              <p className={styles.playerLabel}>🎧 Listen, then buzz in when you know it</p>
              <audio className={styles.player} src={round.audioUrl} controls />
            </div>
          ) : (
            <p className={styles.statusLine}>Waiting for the Host to start this track…</p>
          )}

          <div className={styles.buzzArea}>
            {itsMyTurn && (
              <BuzzImpact team={role}>
                <>
                  {!iSubmitted && (
                    <>
                      <p className={[styles.statusLine, styles.myTurn].join(" ")}>YOU BUZZED</p>
                      <p className={styles.answerLabel}>Your guess</p>
                    </>
                  )}
                  <AnswerInput onSubmit={(text) => void submitAnswer(text)} pending={answering} submitted={iSubmitted} submitLabel="SEND GUESS" placeholder="Song title, artist…" />
                  {iSubmitted && <p className={styles.statusLine}>GUESS SENT</p>}
                </>
              </BuzzImpact>
            )}

            {state.buzzedTeam && !itsMyTurn && (
              <BuzzImpact team={state.buzzedTeam}>
                <div className={styles.otherTeamAnswering}>
                  <p className={styles.statusLine}>{TEAM_LABEL[state.buzzedTeam]} IS ANSWERING</p>
                  {state.submittedAnswer !== null && <p className={styles.theirAnswer}>&ldquo;{state.submittedAnswer}&rdquo;</p>}
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
            {!state.buzzedTeam && !canBuzz && !revealed && myTeamAlreadyOut && otherTeamAlreadyOut && <p className={styles.statusLine}>Both teams have tried this track.</p>}
            {revealed && <p className={styles.statusLine}>Waiting for the Host to continue…</p>}
          </div>
        </div>
      )}

      {!round && <p className={styles.statusLine}>{state.status === "finished" ? "Game finished." : "Waiting for the next track…"}</p>}
    </div>
  );
}
