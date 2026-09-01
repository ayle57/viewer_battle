"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Host/Display's shared "listen together" mechanism — both sync their
 * own `<audio>` element to the SAME server-issued clock
 * (`MusicState.playbackStartedAt`/`playbackPausedAt`, set by
 * START_PLAYBACK/REPLAY_AUDIO/PAUSE_PLAYBACK/RESUME_PLAYBACK — see
 * src/domain/game/music/types.ts's top comment) rather than any
 * peer-to-peer/WebRTC sync: whenever either value changes, this
 * re-derives what SHOULD be true right now (playing at some offset, or
 * paused frozen at one) and makes the real `<audio>` element match.
 * Reconnect-safe for free — a refreshed tab just re-derives the correct
 * offset from the same two timestamps on its next `game:state`
 * snapshot, same self-healing posture as this app's countdown feature.
 * Player's own playback is INTENTIONALLY separate — never routed through
 * this hook, see PlayerMusicPanel's own doc comment.
 *
 * Deliberately just a plain `useEffect` keyed on `[playbackStartedAt,
 * playbackPausedAt]` — no manual "did this actually change" dedup ref:
 * React's own dependency diffing already only re-runs this when one of
 * the two genuinely changes, and every genuine change (a fresh play, a
 * replay, a pause, a resume) is exactly a moment this SHOULD re-sync.
 *
 * Volume is deliberately NOT this hook's concern — it's a plain,
 * uncontrolled property callers set directly on `audioRef.current`
 * (HostMusicPanel's own volume slider), never server state (types.ts's
 * top comment: "baisser/monter le son" is a per-listener setting, not
 * something pushed onto Display/the stream).
 *
 * Browser autoplay policy is the one real limitation here: a Host's own
 * click that triggers START_PLAYBACK/RESUME_PLAYBACK IS a genuine user
 * gesture on their own tab, so their `play()` call almost always
 * succeeds outright; a Display tab (an OBS Browser Source, or a plain
 * browser tab nobody's actively clicking in) may never have had ANY
 * interaction yet, and `play()` can be silently rejected
 * (`NotAllowedError`) until it does. Exposed as `needsUnlock`/`unlock()`
 * — a one-time "Click to enable sound" affordance, not a silent failure;
 * once a tab is unlocked, every subsequent `play()` this session
 * succeeds (the browser remembers the interaction for the page's
 * lifetime). Pausing never needs this — `audio.pause()` has no autoplay
 * restriction.
 */
export function useSyncedAudio(playbackStartedAt: number | null, playbackPausedAt: number | null) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [needsUnlock, setNeedsUnlock] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || playbackStartedAt === null) return;

    function apply() {
      if (!audio) return;
      if (playbackPausedAt !== null) {
        // Paused — freeze at the exact offset that was true the instant
        // it paused, and stop. Never touches `needsUnlock`: pausing
        // itself can't be blocked by autoplay policy.
        const offsetSeconds = Math.max(0, (playbackPausedAt! - playbackStartedAt!) / 1000);
        audio.currentTime = offsetSeconds;
        audio.pause();
        return;
      }
      // Playing — seek to the live elapsed offset and play.
      const offsetSeconds = Math.max(0, (Date.now() - playbackStartedAt!) / 1000);
      audio.currentTime = offsetSeconds;
      audio
        .play()
        .then(() => setNeedsUnlock(false))
        .catch(() => setNeedsUnlock(true));
    }

    // `HAVE_METADATA` (readyState >= 1) is when `duration`/seeking are
    // actually meaningful — a freshly-swapped `src` (a new round) hasn't
    // loaded that far yet, so this waits for it rather than assigning
    // `currentTime` against an element that hasn't decided its own
    // length, which some browsers silently ignore.
    if (audio.readyState >= 1) {
      apply();
      return;
    }
    audio.addEventListener("loadedmetadata", apply, { once: true });
    return () => audio.removeEventListener("loadedmetadata", apply);
  }, [playbackStartedAt, playbackPausedAt]);

  function unlock() {
    const audio = audioRef.current;
    if (!audio) return;
    audio
      .play()
      .then(() => setNeedsUnlock(false))
      .catch(() => {});
  }

  return { audioRef, needsUnlock, unlock };
}
