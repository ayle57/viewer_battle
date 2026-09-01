"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp } from "@/app/_shared/motion/variants";
import type { MusicState } from "@/domain/game/music";
import { AnimatedScoreDisplay } from "@/app/_shared/boardQuestion/AnimatedScoreDisplay"; // generic (ScoreDisplayProps-only) despite the folder name — same cross-engine reuse GeoGuessr's own HostGeoPanel already relies on
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog } from "@/ui";
import { readableMusicError } from "./gameErrorMessages";
import { useSyncedAudio } from "./useSyncedAudio";
import styles from "./HostMusicPanel.module.css";

export interface HostMusicPanelProps {
  state: MusicState;
  sendAction: (action: Record<string, unknown>) => Promise<{ ok: boolean; error?: { code: string; message: string } }>;
}

const TEAM_LABEL: Record<"TEAM_A" | "TEAM_B", string> = { TEAM_A: "Team A", TEAM_B: "Team B" };

type PendingAction =
  | "START_PLAYBACK"
  | "REPLAY_AUDIO"
  | "PAUSE_PLAYBACK"
  | "RESUME_PLAYBACK"
  | "JUDGE_CORRECT"
  | "JUDGE_INCORRECT"
  | "SKIP_ROUND"
  | "NEXT_ROUND"
  | "END_GAME"
  | null;

/**
 * The host's control surface — the buzzer-race half is BoardQuestion's
 * own HostBoardPanel shape verbatim (BUZZ -> SUBMIT_ANSWER ->
 * JUDGE_ANSWER, a steal on a wrong answer — see
 * src/domain/game/music/types.ts's top comment on why this engine
 * deliberately reuses that mechanic), plus the one thing genuinely new
 * to this game: the round's mandatory first shared play. HOST always
 * gets the real, unredacted `title`/`artist` (the "answer key" block
 * below) — same posture as BoardQuestionEngine's Host-only `answer`,
 * shown here even before reveal so the Host can actually judge a
 * submitted guess against it.
 */
export function HostMusicPanel({ state, sendAction }: HostMusicPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const [pending, setPending] = useState<PendingAction>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [endGameOpen, setEndGameOpen] = useState(false);
  // Local-only, never sent anywhere — this is the Host's own MONITOR
  // level (types.ts's top comment, point 3), separate from
  // `state.broadcastVolume` below (what Display/the stream actually
  // plays). Starts at 1 (the browser's own default) so a Host who never
  // touches either control hears/broadcasts the clip at full volume,
  // same as before either control existed.
  const [monitorVolume, setMonitorVolume] = useState(1);
  const [monitorMuted, setMonitorMuted] = useState(false);
  // The real "what does the audience hear" control — a REAL, REPORTED
  // follow-up ("j'ai l'impression que la gestion de la puissance du son
  // fonctionne pas... ajoute plus de controle"): the local monitor
  // slider above never touched what Display/OBS actually played, which
  // is what a streamer overwhelmingly means by "the sound." Initialized
  // once from the server's own current value (not resynced afterward —
  // this Host tab is the only place this ever changes, same single-
  // controller posture as `monitorVolume`'s own local state), dispatched
  // debounced (see `commitBroadcastVolume`) rather than on every slider
  // tick, so dragging doesn't hammer the server with a SET_VOLUME per
  // pixel moved.
  const [broadcastVolumeDraft, setBroadcastVolumeDraft] = useState(state.broadcastVolume);
  const broadcastVolumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { audioRef, needsUnlock, unlock } = useSyncedAudio(state.playbackStartedAt, state.playbackPausedAt);

  async function act(kind: PendingAction, action: Record<string, unknown>) {
    setPending(kind);
    setError(null);
    const result = await sendAction(action);
    if (!result.ok && result.error) setError(result.error);
    setPending(null);
  }

  // Starting/resuming playback are the two actions here that ALSO need a
  // real, synchronous browser user-gesture on THIS tab to reliably
  // autoplay — calling `sendAction` first (an async round trip) would
  // lose that gesture by the time the response comes back and this
  // component re-renders with a new `playbackStartedAt`. Priming
  // `audio.play()` directly inside the click handler, before awaiting
  // anything, keeps it inside the same gesture; `useSyncedAudio`'s own
  // effect then re-seeks it to the exact server-issued offset the
  // instant the real state lands, which is a no-op time-wise since the
  // round trip is only a handful of ms. Pausing has no such restriction
  // (`audio.pause()` is never blocked), but priming it locally first
  // still makes the Host's own click feel instant instead of waiting on
  // the round trip.
  async function startOrReplay(kind: "START_PLAYBACK" | "REPLAY_AUDIO") {
    audioRef.current?.play().catch(() => {});
    await act(kind, { type: kind });
  }

  async function pause() {
    audioRef.current?.pause();
    await act("PAUSE_PLAYBACK", { type: "PAUSE_PLAYBACK" });
  }

  async function resume() {
    audioRef.current?.play().catch(() => {});
    await act("RESUME_PLAYBACK", { type: "RESUME_PLAYBACK" });
  }

  function handleMonitorVolumeChange(next: number) {
    setMonitorVolume(next);
    if (audioRef.current) audioRef.current.volume = next;
  }

  // Native `.muted`, not zeroing `.volume` — preserves the dialed-in
  // level underneath so un-muting restores it exactly, instead of the
  // Host having to re-drag the slider back to where it was. The obvious
  // "I'm monitoring through Display/OBS instead, I don't need my own
  // tab making noise too" escape hatch — the exact scenario a Host
  // running Host+Display on the SAME machine hits constantly.
  function toggleMonitorMute() {
    const next = !monitorMuted;
    setMonitorMuted(next);
    if (audioRef.current) audioRef.current.muted = next;
  }

  // Debounced — a slider's `onChange` fires on every pixel of drag, and
  // sending a real SET_VOLUME (a socket round trip + a DB write) for
  // each one would hammer the server for zero benefit; only the value
  // the Host actually settles on for ~200ms needs to reach Display.
  // `broadcastVolumeDraft` still updates instantly for the slider's OWN
  // visual feedback — only the server dispatch is delayed.
  function handleBroadcastVolumeChange(next: number) {
    setBroadcastVolumeDraft(next);
    if (broadcastVolumeTimer.current) clearTimeout(broadcastVolumeTimer.current);
    broadcastVolumeTimer.current = setTimeout(() => {
      void sendAction({ type: "SET_VOLUME", volume: next }).then((result) => {
        if (!result.ok && result.error) setError(result.error);
      });
    }, 200);
  }

  useEffect(() => {
    return () => {
      if (broadcastVolumeTimer.current) clearTimeout(broadcastVolumeTimer.current);
    };
  }, []);

  // The `<audio>` element itself remounts on a real round change (the
  // parent `motion.div key={state.currentRoundIndex}` below) — a fresh
  // DOM node starts back at the browser's own defaults (volume 1, not
  // muted), silently discarding whatever the Host had dialed in for the
  // previous track. Re-applies both the CURRENT `monitorVolume` and
  // `monitorMuted` to the new element the moment it mounts; the
  // controls' own onChange handlers already apply them instantly for
  // every other change, so this only ever has real work to do right
  // after a remount.
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = monitorVolume;
      audioRef.current.muted = monitorMuted;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on the round change (what actually remounts the <audio> element), not on `monitorVolume`/`monitorMuted`/`audioRef` themselves — see this effect's own comment
  }, [state.currentRoundIndex]);

  const round = state.rounds[state.currentRoundIndex];
  const revealed = state.phase === "revealed";
  const teamVariant = state.buzzedTeam === "TEAM_A" ? "teamA" : state.buzzedTeam === "TEAM_B" ? "teamB" : "neutral";
  const lastResult = state.status === "finished" ? null : lastRoundResult(state);

  return (
    <div className={styles.wrap}>
      <Card variant="raised">
        <CardBody>
          <AnimatedScoreDisplay
            teamAName="Team A"
            teamAScore={state.scores.TEAM_A}
            teamBName="Team B"
            teamBScore={state.scores.TEAM_B}
            label={state.status === "finished" ? `Game over — ${state.winner === "TIE" ? "tie" : `${TEAM_LABEL[state.winner as "TEAM_A" | "TEAM_B"]} wins`}` : undefined}
          />
        </CardBody>
      </Card>

      {state.status !== "finished" && (
        <div className={styles.endGameRow}>
          <Button variant="danger" size="sm" disabled={pending !== null} onClick={() => setEndGameOpen(true)}>
            End game
          </Button>
        </div>
      )}

      {error && <p className={styles.errorBanner}>{readableMusicError(error.code, error.message)}</p>}
      {!error && !revealed && lastResult && <p className={styles.resultBanner}>{lastResult}</p>}

      {round && (
        <motion.div key={state.currentRoundIndex} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 14, duration: 0.4 })}>
          <p className={styles.roundLabel}>
            TRACK {state.currentRoundIndex + 1} / {state.rounds.length}
          </p>
          <Card>
            <CardHeader title={round.title ?? `Track ${state.currentRoundIndex + 1}`} subtitle={round.artist ?? undefined} />
            <CardBody>
              {/* Hidden — no NATIVE controls: the browser's own built-in
                  pause/seek bar would let the Host desync from Display's
                  copy with no way to signal that back. Real custom
                  controls below (Pause/Resume/Replay) go through actual
                  Kernel actions instead, so Display always stays in
                  sync; the "Your monitor" slider/mute below is the one
                  control that's genuinely local-only, applied straight
                  to THIS element — "Stream volume" is a separate, real,
                  synced control (this file's own top comment).
                  Guarded on a real `audioUrl` — HOST's own state is
                  never redacted so this is always true in practice, but
                  an empty string is a real bug if it ever weren't (see
                  DisplayMusicPanel's identical guard/comment: the
                  browser reads `src=""` as "fetch the current page as
                  audio," not a harmless no-op). */}
              {round.audioUrl && <audio ref={audioRef} src={round.audioUrl} className={styles.hiddenAudio} />}

              {state.phase === "intro" ? (
                <div className={styles.playbackBlock}>
                  <p className={styles.hint}>Everyone hears this track together for the first time once you press play.</p>
                  <Button size="lg" fullWidth loading={pending === "START_PLAYBACK"} disabled={pending !== null} onClick={() => void startOrReplay("START_PLAYBACK")}>
                    ▶ Play for everyone
                  </Button>
                </div>
              ) : (
                <div className={styles.playbackStatusRow}>
                  {state.playbackPausedAt !== null ? (
                    <Badge variant="neutral" dot>
                      ⏸ Paused
                    </Badge>
                  ) : (
                    <Badge variant="neutral" dot>
                      🎵 Playing
                    </Badge>
                  )}
                  {needsUnlock && (
                    <button type="button" className={styles.unlockButton} onClick={unlock}>
                      Click to enable sound
                    </button>
                  )}
                  {state.playbackPausedAt !== null ? (
                    <Button variant="secondary" size="sm" loading={pending === "RESUME_PLAYBACK"} disabled={pending !== null} onClick={() => void resume()}>
                      ▶ Resume
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" loading={pending === "PAUSE_PLAYBACK"} disabled={pending !== null} onClick={() => void pause()}>
                      ⏸ Pause
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" loading={pending === "REPLAY_AUDIO"} disabled={pending !== null} onClick={() => void startOrReplay("REPLAY_AUDIO")}>
                    🔁 Replay
                  </Button>
                </div>
              )}

              {/* Two DISTINCT, clearly-labeled controls — the real fix
                  for "j'ai l'impression que la gestion du son fonctionne
                  pas": what used to be one unlabeled slider was ALWAYS
                  local-only, so turning it down while checking the sound
                  on Display/OBS looked like it did nothing. Available
                  from "intro" onward (SET_VOLUME is legal any phase —
                  engine.ts's own applySetVolume) so a Host can pre-set
                  the stream level before ever pressing Play. */}
              <div className={styles.volumeSection}>
                <label className={styles.volumeControl}>
                  <span className={styles.volumeLabel}>🎧 Your monitor</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={monitorVolume}
                    onChange={(event) => handleMonitorVolumeChange(Number(event.target.value))}
                    aria-label="Your own monitor volume — only affects what you hear on this tab"
                    className={styles.volumeSlider}
                    disabled={monitorMuted}
                  />
                  <button
                    type="button"
                    className={[styles.muteButton, monitorMuted && styles.muteButtonActive].filter(Boolean).join(" ")}
                    onClick={toggleMonitorMute}
                    aria-pressed={monitorMuted}
                    aria-label={monitorMuted ? "Unmute your monitor" : "Mute your monitor"}
                  >
                    {monitorMuted ? "🔇" : "🔊"}
                  </button>
                </label>
                <label className={styles.volumeControl}>
                  <span className={styles.volumeLabel}>📡 Stream volume</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={broadcastVolumeDraft}
                    onChange={(event) => handleBroadcastVolumeChange(Number(event.target.value))}
                    aria-label="Stream volume — what Display and your audience actually hear"
                    className={styles.volumeSlider}
                  />
                  <span className={styles.volumePercent}>{Math.round(broadcastVolumeDraft * 100)}%</span>
                </label>
              </div>

              {state.phase === "guessing" && (
                <div className={styles.statusBlock}>
                  <Badge variant="neutral">Waiting for a buzz…</Badge>
                  {state.attemptedTeams.length > 0 && (
                    <p className={styles.hint}>{state.attemptedTeams.map((t) => TEAM_LABEL[t]).join(", ")} already tried — steal is open.</p>
                  )}
                </div>
              )}

              {state.phase === "answering" && state.submittedAnswer === null && (
                <div className={styles.statusBlock}>
                  <p className={[styles.bigBuzz, styles[teamVariant]].join(" ")}>{state.buzzedTeam && TEAM_LABEL[state.buzzedTeam]} BUZZED</p>
                  <p className={styles.hint}>Waiting on their answer…</p>
                </div>
              )}

              {state.phase === "answering" && state.submittedAnswer !== null && (
                <div className={styles.statusBlock}>
                  <Badge variant={teamVariant}>{state.buzzedTeam && TEAM_LABEL[state.buzzedTeam]} answers</Badge>
                  <p className={styles.submittedAnswer}>&ldquo;{state.submittedAnswer}&rdquo;</p>
                  <div className={styles.judgeRow}>
                    <Button size="lg" loading={pending === "JUDGE_CORRECT"} disabled={pending !== null} onClick={() => void act("JUDGE_CORRECT", { type: "JUDGE_ANSWER", correct: true })}>
                      ✓ Correct
                    </Button>
                    <Button
                      size="lg"
                      variant="secondary"
                      loading={pending === "JUDGE_INCORRECT"}
                      disabled={pending !== null}
                      onClick={() => void act("JUDGE_INCORRECT", { type: "JUDGE_ANSWER", correct: false })}
                    >
                      ✕ Incorrect
                    </Button>
                  </div>
                </div>
              )}

              {revealed && (
                <div className={styles.resultBlock}>
                  <p
                    className={[styles.resultHeadline, lastRoundWinner(state) === "TEAM_A" && styles.resultTeamA, lastRoundWinner(state) === "TEAM_B" && styles.resultTeamB]
                      .filter(Boolean)
                      .join(" ")}
                  >
                    {lastRoundWinner(state) === "TIE" ? "NOBODY GOT IT" : `${TEAM_LABEL[lastRoundWinner(state) as "TEAM_A" | "TEAM_B"]} WINS THE ROUND`}
                  </p>
                  <p className={styles.answerReveal}>
                    That was: <strong>{round.title}</strong>
                    {round.artist ? ` — ${round.artist}` : ""}
                  </p>
                  {state.status !== "finished" && (
                    <Button size="lg" fullWidth loading={pending === "NEXT_ROUND"} disabled={pending !== null} onClick={() => void act("NEXT_ROUND", { type: "NEXT_ROUND" })}>
                      Next track →
                    </Button>
                  )}
                </div>
              )}

              {(state.phase === "guessing" || state.phase === "answering") && (
                <div className={styles.closeRow}>
                  <Button variant="ghost" size="sm" loading={pending === "SKIP_ROUND"} disabled={pending !== null} onClick={() => void act("SKIP_ROUND", { type: "SKIP_ROUND" })}>
                    Skip track (no winner)
                  </Button>
                </div>
              )}
            </CardBody>
          </Card>
        </motion.div>
      )}

      <ConfirmDialog
        open={endGameOpen}
        title="End this game now?"
        description="Whatever track is in progress is abandoned — nobody wins it. The winner is whoever's ahead right now, or a tie if the scores are even."
        confirmLabel="End game"
        danger
        confirming={pending === "END_GAME"}
        onCancel={() => setEndGameOpen(false)}
        onConfirm={() => {
          setEndGameOpen(false);
          void act("END_GAME", { type: "END_GAME" });
        }}
      />
    </div>
  );
}

/** The most recently closed round's winner, straight from `history` — used only once `phase === "revealed"`, when the current round's own outcome is always the LAST entry (closeRound just appended it, engine.ts). */
function lastRoundWinner(state: MusicState): "TEAM_A" | "TEAM_B" | "TIE" {
  const last = state.history[state.history.length - 1];
  return last?.wonBy ?? "TIE";
}

/** A short "Team A won the last track" line shown while the NEXT track is already underway — same "what just happened" reminder BoardQuestion's own describeLastResult provides, simpler here since Music has only ever one outcome per round (no partial-credit/point-value nuance). */
function lastRoundResult(state: MusicState): string | null {
  if (state.currentRoundIndex === 0 && state.history.length === 0) return null;
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  return last.wonBy ? `${TEAM_LABEL[last.wonBy]} won the last track.` : "Nobody got the last track.";
}
