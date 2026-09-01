"use client";

import { useEffect } from "react";
import type { MusicState } from "@/domain/game/music";
import { Card, CardBody } from "@/ui";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay";
import { BuzzImpact } from "@/app/_shared/boardQuestion/BuzzImpact";
import { describeLastResult, lastJudgment } from "./events";
import { useSyncedAudio } from "./useSyncedAudio";
import styles from "./DisplayMusicPanel.module.css";

export interface DisplayMusicPanelProps {
  state: MusicState;
  lastEvents: unknown[];
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "TEAM A", TEAM_B: "TEAM B" };

/**
 * Read-only, built for OBS capture — no `sendAction` prop, same posture
 * as DisplayBoardPanel.tsx. This is the ONE role that's genuinely
 * expected to be an unattended browser tab (an OBS Browser Source), so
 * it's also the clearest real-world case for `useSyncedAudio`'s own
 * `needsUnlock` affordance: a Display tab that's never been clicked in
 * may need one manual "Click to enable sound" before OBS actually
 * captures audio, unlike the Host's own tab (whose click on "Play for
 * everyone" already IS a real gesture).
 */
export function DisplayMusicPanel({ state, lastEvents }: DisplayMusicPanelProps) {
  const { audioRef, needsUnlock, unlock } = useSyncedAudio(state.playbackStartedAt, state.playbackPausedAt);
  const round = state.rounds[state.currentRoundIndex];

  // The real "control what the audience hears" volume (HostMusicPanel's
  // own doc comment on why this is genuine synced state, not a
  // client-side-only property like the Host's own monitor level) —
  // applied here, not inside `useSyncedAudio`, since that hook is
  // shared with HostMusicPanel's own LOCAL, independent volume concept
  // and has no business knowing about this one. Re-applies on every
  // round change too — the `<audio>` element itself remounts then
  // (`key={state.currentRoundIndex}` below), which would otherwise
  // silently reset a fresh DOM node back to the browser's own default
  // (1), discarding whatever the Host had the stream dialed to.
  //
  // Also keyed on `round.audioUrl` itself, not just `currentRoundIndex`:
  // the `<audio>` element below only actually exists once `audioUrl`
  // stops being blanked to "" (i.e. once phase leaves "intro" — see the
  // comment on the element itself). The Host can legally dial in the
  // stream volume *during* "intro", before that element is born, at
  // which point `audioRef.current` is still null and this effect is a
  // no-op. Without `round.audioUrl` in the deps, the effect then never
  // re-runs at the exact moment the element mounts — `broadcastVolume`
  // and `currentRoundIndex` are both already unchanged by then — and
  // the fresh node is silently left at the browser default (1), a real
  // bug caught live: Display kept playing at full volume no matter what
  // the Host's "Stream volume" slider said, whenever it was set pre-Play.
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = state.broadcastVolume;
  }, [audioRef, state.broadcastVolume, state.currentRoundIndex, round?.audioUrl]);
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
        <Card variant="raised" key={state.currentRoundIndex} className={styles.trackEnter}>
          <CardBody>
            {/* No `src` at all while still "intro" (view.ts blanks
                `audioUrl` to "" pre-play) — an empty string is a real,
                observed bug, not a harmless placeholder: the browser
                reads it as "fetch the current page as audio," a genuine
                wasted request React itself warns about. `useSyncedAudio`
                only ever acts once `playbackStartedAt` is non-null,
                which is exactly when `audioUrl` is guaranteed real too
                (both flip together, off the same phase transition). */}
            {round.audioUrl && <audio ref={audioRef} src={round.audioUrl} className={styles.hiddenAudio} />}
            {revealed ? (
              <div className={styles.revealBlock}>
                <p className={styles.revealLabel}>THAT WAS</p>
                <p className={styles.revealTitle}>{round.title}</p>
                {round.artist && <p className={styles.revealArtist}>{round.artist}</p>}
              </div>
            ) : state.phase === "intro" ? (
              <p className={styles.statusLine}>Get ready…</p>
            ) : (
              <div className={[styles.nowPlaying, state.playbackPausedAt !== null && styles.paused].filter(Boolean).join(" ")}>
                <span className={styles.nowPlayingDot} aria-hidden="true" />
                {state.playbackPausedAt !== null ? "PAUSED" : "NOW PLAYING"}
                {needsUnlock && (
                  <button type="button" className={styles.unlockButton} onClick={unlock}>
                    Click to enable sound
                  </button>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {state.buzzedTeam && (
        <BuzzImpact team={state.buzzedTeam}>
          <div className={styles.buzzedBlock}>
            <p className={[styles.buzzedBanner, teamClass].join(" ")}>{TEAM_LABEL[state.buzzedTeam]} IS ANSWERING</p>
            {state.submittedAnswer !== null && <p className={styles.submittedAnswer}>&ldquo;{state.submittedAnswer}&rdquo;</p>}
          </div>
        </BuzzImpact>
      )}

      {!state.buzzedTeam && judgment && (
        <p className={[styles.judgmentBanner, judgment.correct ? styles.correct : styles.incorrect].join(" ")}>{judgment.correct ? "CORRECT" : "INCORRECT"}</p>
      )}
      {!state.buzzedTeam && !judgment && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

      {!round && state.status === "in_progress" && <p className={styles.statusLine}>Waiting for the next track…</p>}
    </div>
  );
}
