"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Button, Card, CardBody, CardHeader, Input, TeamRoster } from "@/ui";
import { DisplayBoardPanel } from "@/app/_shared/boardQuestion/DisplayBoardPanel";
import { DisplayGeoPanel } from "@/app/_shared/geoGuessr/DisplayGeoPanel";
import { DisplayDrawingPanel } from "@/app/_shared/drawing/DisplayDrawingPanel";
import { DisplayMusicPanel } from "@/app/_shared/music/DisplayMusicPanel";
import { DisplaySteamPanel } from "@/app/_shared/steamRatings/DisplaySteamPanel";
import { DisplayPricePanel } from "@/app/_shared/guessThePrice/DisplayPricePanel";
import { DisplayPointingPanel } from "@/app/_shared/pointingSystem/DisplayPointingPanel";
import { MatchScore } from "@/app/_shared/MatchScore";
import { WinnerReveal } from "@/app/_shared/boardQuestion/WinnerReveal";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { HostDisconnectedBanner } from "@/app/_shared/HostDisconnectedBanner";
import { StatusBanner } from "@/app/_shared/StatusBanner";
import { SessionEndedNotice } from "@/app/_shared/SessionEndedNotice";
import { KickedNotice } from "@/app/_shared/KickedNotice";
import { GameStartingSequence } from "@/app/_shared/GameStartingSequence";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { deriveSessionPhase, readGameStatus } from "@/app/_shared/sessionPhase";
import { useGameStartingSequence } from "@/app/_shared/useGameStartingSequence";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
import { getLastDisplayName, saveLastDisplayName, clearLastDisplayName } from "@/app/_shared/lastDisplayName";
import { RememberedNameHint } from "@/app/_shared/RememberedNameHint";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import type { Scoreboard } from "@/domain/game";
import type { TeamRole } from "@/domain/session";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";
import type { DrawingState } from "@/domain/game/drawing";
import type { MusicState } from "@/domain/game/music";
import type { SteamRatingsState } from "@/domain/game/steamRatings";
import type { GuessThePriceState } from "@/domain/game/guessThePrice";
import type { PointingSystemState } from "@/domain/game/pointingSystem";

/** See host/page.tsx's identical type — the generic slice WinnerReveal needs, without either engine's full state type. */
type GenericGameState = { scores: Scoreboard; winner: TeamRole | "TIE" | null };

export default function DisplayPage() {
  return (
    // `vb-dark-scope` (tokens.css) — Display is the on-stream broadcast
    // output (OBS Browser Source), so it stays dark regardless of the
    // machine's OS theme, exactly the principle `--vb-obs-bg` already
    // encodes and the same always-dark treatment `/player` uses. An OBS
    // CEF source reports no colour-scheme preference (renders light by
    // default), which would otherwise put a white scoreboard on stream
    // while every player screen is the dark "premium gameshow" look.
    <main className={`${styles.page} vb-dark-scope`}>
      {/* `useSearchParams()` below opts its subtree out of static
          rendering (Next.js requirement) — a `Suspense` boundary right
          here is the fix, not a real loading state: everything this
          page needs (the persisted `identity`, the URL's own `?code=`)
          is client-only anyway, so the fallback only shows for a
          genuinely instant beat before hydration, if ever. Rendering
          `<DisplayConnect />` with no auto-code as that fallback is
          exactly what an SSR pass of this page already produces on its
          own (there's no `sessionStorage`/`URLSearchParams` on the
          server either), so this introduces no new state the rest of
          the page doesn't already have to handle. */}
      <Suspense fallback={<DisplayConnect />}>
        <DisplayRoot />
      </Suspense>
    </main>
  );
}

function DisplayRoot() {
  const identity = useIdentityStore((state) => state.identity);
  // `?code=X7K2QP&name=OBS` — the real OBS optimization this file exists
  // for. `identityStore.ts` persists to `sessionStorage` DELIBERATELY
  // (its own doc comment: a second tab must be able to become a
  // different participant) — real for a person testing Host/Player in
  // several tabs, but exactly the wrong tradeoff for an OBS Browser
  // Source: OBS is its own separate CEF process, and restarting OBS
  // (crashes, closing the app between streams, "refresh cache of
  // current page") throws sessionStorage away same as closing any
  // browser tab — the Display would land back on this bare connect form
  // with nobody there to type a code into it. Rather than weakening that
  // real, documented multi-tab guarantee for the two roles that still
  // need it, Display gets its own, purely additive escape hatch: a
  // session code baked into the URL itself, which is exactly what
  // survives in OBS's own scene-collection file across restarts — the
  // one piece of "memory" an OBS source genuinely has. See
  // DisplayConnect's own doc comment for the auto-join/retry behavior
  // this query param drives.
  const searchParams = useSearchParams();
  const autoCode = searchParams.get("code")?.trim() || undefined;
  const autoName = searchParams.get("name")?.trim() || undefined;
  return identity && identity.role === "DISPLAY" ? <DisplayGame identity={identity} /> : <DisplayConnect autoCode={autoCode} autoName={autoName} />;
}

interface DisplayConnectProps {
  /** From `?code=` — pre-fills AND silently auto-submits the join the instant this mounts, no click needed. */
  autoCode?: string;
  /** From `?name=` — takes priority over a remembered name (this file's own doc comment: an explicit URL is a stronger signal than "whatever this browser last used"). */
  autoName?: string;
}

/**
 * The one entry point that turns "nobody" into a real DISPLAY identity.
 * No team choice (Display isn't on a team) — just a code and a name so
 * OBS logs/whoever's watching this connection can tell which display it
 * is if there's more than one.
 */
function DisplayConnect({ autoCode, autoName }: DisplayConnectProps) {
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const [sessionCode, setSessionCode] = useState(autoCode ?? "");
  const [displayName, setDisplayName] = useState(autoName ?? "OBS Display");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // See PlayerJoin's identical field — RememberedNameHint below is what
  // this drives.
  const [remembered, setRemembered] = useState<string | null>(null);
  // True from mount whenever `?code=` was actually given, until either a
  // join succeeds (this component unmounts, nothing left to track) or a
  // human physically edits a field / hits Connect themselves — see
  // `takeOver` below. Drives BOTH the silent auto-submit-on-mount and
  // the retry loop while it's still true; once a person touches this
  // form it behaves exactly like the plain manual flow always has, even
  // if a later auto-retry was already in flight (the retry effect's own
  // cleanup below tears down its interval the same render this flips).
  const [autoConnecting, setAutoConnecting] = useState(Boolean(autoCode));

  // Real, reported friction — see PlayerJoin's identical effect (src/app/
  // player/page.tsx) for the full doc comment on why this is a
  // post-mount effect, not a `useState` initializer. Only overrides the
  // "OBS Display" placeholder if a real remembered name actually exists
  // — an explicit `?name=` (already applied above) still wins over it.
  useEffect(() => {
    if (autoName) return;
    const stored = getLastDisplayName("display");
    // A genuine one-time read of an external system (localStorage) on
    // mount — not a subscription with an ongoing value to track, so
    // there's no render-phase equivalent (PageChangeCurtain.tsx's own
    // comment on that pattern) to reach for instead here.
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemembered(stored);
      setDisplayName(stored);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once on mount, `autoName` is a route param that can't change under a mounted component
  }, []);

  function logOutRememberedName() {
    clearLastDisplayName("display");
    setRemembered(null);
    setDisplayName("");
  }

  /** A human touching the form themselves always wins over the URL's own auto-connect — same "explicit beats remembered" posture as `autoName` vs. a stored name above. */
  function takeOver() {
    if (autoConnecting) setAutoConnecting(false);
  }

  const joinSession = trpc.session.join.useMutation();

  async function handleJoin(codeOverride?: string, nameOverride?: string) {
    const code = (codeOverride ?? sessionCode).trim().toUpperCase();
    const name = (nameOverride ?? displayName).trim();
    if (!code || !name) return;
    setJoining(true);
    setError(null);
    try {
      const result = await joinSession.mutateAsync({ sessionCode: code, role: "DISPLAY", displayName: name });
      saveLastDisplayName("display", name);
      setIdentity({ sessionCode: code, role: "DISPLAY", displayName: result.displayName, token: result.token, participantId: result.id });
    } catch (err) {
      const errorCode = err instanceof TRPCClientError ? err.data?.sessionErrorCode : undefined;
      setError(readableSessionError(errorCode, err instanceof Error ? err.message : "Couldn't connect — try again."));
    } finally {
      setJoining(false);
    }
  }

  // Silent auto-submit the instant `?code=` lands, then keep retrying —
  // no click, nobody's there to click it. Retrying (not a one-shot
  // attempt) matters for the single most common real ordering: a
  // streamer adds the OBS Browser Source with today's URL BEFORE
  // actually starting the Host session, so the very first attempt is
  // EXPECTED to 404 (SESSION_NOT_FOUND) — that's not a real error here,
  // it's "keep watching for the show to start." A plain `setInterval`,
  // not a query's own `refetchInterval` (this is a mutation, one-shot by
  // nature) — cleared the moment `autoConnecting` goes false (a real
  // join landed and this component is about to unmount, or a human took
  // over via `takeOver()`), so it can never keep firing against a
  // session this tab has already moved past.
  const attemptedOnMount = useRef(false);
  useEffect(() => {
    if (!autoConnecting || !autoCode) return;
    if (!attemptedOnMount.current) {
      attemptedOnMount.current = true;
      void handleJoin(autoCode, autoName ?? displayName);
    }
    const interval = setInterval(() => void handleJoin(autoCode, autoName ?? displayName), 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on autoConnecting alone, not displayName/sessionCode: every path that could change either one (the form's own onChange handlers) calls `takeOver()` FIRST, flipping `autoConnecting` false and tearing this interval down through this exact dependency — so the closure below never actually needs to observe a value newer than the one captured when it was created; autoCode/autoName are stable route params on top of that.
  }, [autoConnecting]);

  // A real, audited gap: `?code=` (an OBS source already configured and
  // pointed at this URL — see this component's own doc comment) is
  // "operational" by definition, yet every retry while waiting for the
  // next show to start rendered the exact same administrative form
  // (labeled inputs, a Connect button) a human sets up a Display with for
  // the FIRST time — awkward to have live in an OBS capture between
  // shows, and easy to mistake for something broken. Once a real person
  // actually touches the form (`takeOver()` — typing, or submitting by
  // hand), this steps aside immediately and the normal form below takes
  // over, same as if `?code=` had never been there. Same visual language
  // as DisplayGame's own "SYNCING…" hero (`.hero`/`.title`/`.waiting`)
  // rather than a new screen invented for this — the retry loop itself
  // (the effect above) keeps running unchanged underneath either way.
  if (autoConnecting && autoCode) {
    return (
      <div className={styles.hero}>
        <h1 className={`${styles.title} vb-wordmark-transition`}>VIEWERBATTLE</h1>
        <p className={styles.waiting}>{error ? `WAITING FOR SESSION ${sessionCode}` : `CONNECTING TO SESSION ${sessionCode}`}</p>
        {/* A real, found-in-testing gap this closes: OBS never clicks
            anything (the whole reason this hero replaces the form at
            all), but a HUMAN who opens this exact URL directly — to
            check why a configured source isn't connecting, e.g. a typo
            in `?code=` — used to have literally no way back to the real
            form once this branch took over; `takeOver()` only triggers
            from touching a field this branch no longer renders. Quiet
            on purpose (an OBS capture should never notice it's there),
            not styled as a real call to action. */}
        <button type="button" className={styles.editConnectionLink} onClick={takeOver}>
          Not right? Edit connection
        </button>
      </div>
    );
  }

  return (
    <div className={styles.connect}>
      <Card variant="raised">
        <CardHeader title="Connect Display" subtitle="ViewerBattle — for OBS" />
        <CardBody>
          <form
            className={styles.connectForm}
            onSubmit={(event) => {
              event.preventDefault();
              takeOver();
              void handleJoin();
            }}
          >
            <Input
              size="lg"
              label="Session code"
              value={sessionCode}
              onChange={(event) => {
                takeOver();
                setSessionCode(event.target.value);
              }}
              placeholder="e.g. X7K2QP"
              autoFocus
            />
            <Input
              size="lg"
              label="Display name"
              value={displayName}
              onChange={(event) => {
                takeOver();
                setDisplayName(event.target.value);
              }}
            />
            {remembered && displayName === remembered && <RememberedNameHint name={remembered} onLogout={logOutRememberedName} />}
            {/* While still auto-connecting, a failed attempt is expected
                (the Host just hasn't started yet) — a calm status line,
                not the same red banner a human typing a genuinely wrong
                code by hand should see. Taking the form over at any
                point (`takeOver`) switches straight to that normal
                error posture, same as if `?code=` had never been there. */}
            {error && !autoConnecting && <p className={styles.errorBanner}>{error}</p>}
            {autoConnecting && <p className={styles.autoConnectStatus}>{error ? `Waiting for session ${sessionCode} to start…` : `Connecting to session ${sessionCode}…`}</p>}
            <Button size="lg" type="submit" loading={joining} disabled={!sessionCode.trim() || !displayName.trim()} fullWidth>
              Connect
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function DisplayGame({ identity }: { identity: Identity }) {
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const { sendChatMessage, requestDrawingSnapshot } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameKey = useGameStore((state) => state.gameKey);
  const rawGameState = useGameStore((state) => state.gameState);
  const gameState = rawGameState as unknown as GenericGameState | null;
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const liveSessionEnded = useGameStore((state) => state.sessionEnded);
  const kicked = useGameStore((state) => state.kicked);
  const synced = useGameStore((state) => state.synced);
  const presence = usePresenceStore((state) => state.participants);
  const hostConnected = presence.some((p) => p.role === "HOST");

  // The one deliberate exception to "Display never acts" (see the
  // GAME_FINISHED render below for the button this powers, and
  // router.ts's game.start for the server-side half of this exception —
  // sample content only, no Playlist selection possible from here).
  const startNext = trpc.game.start.useMutation();
  function handleStartNext() {
    if (!gameKey) return;
    startNext.mutate({ token: identity.token, gameKey: gameKey as "board-question" | "geoguessr" });
  }

  const sessionState = trpc.session.getState.useQuery(
    { sessionCode: identity.sessionCode },
    { refetchInterval: 2000, retry: false },
  );
  const roster = sessionState.data;

  // See host/page.tsx's identical comment.
  const sessionEnded = liveSessionEnded || sessionState.error?.data?.sessionErrorCode === "SESSION_NOT_FOUND";
  const phase = deriveSessionPhase({ sessionStatus: sessionState.data?.status, gameId, gameStatus: readGameStatus(rawGameState), sessionEnded });

  // Same countdown, same reasoning as player/page.tsx's identical block —
  // Display never clicks Start either, it only learns a game began from
  // `phase` changing under it, so this fires off a real witnessed
  // transition rather than a click handler.
  const { sequenceActive, setSequenceActive } = useGameStartingSequence(phase, synced);

  // Display is the one role nobody sits at a keyboard for — it's the
  // OBS browser source, left running unattended for an entire stream,
  // possibly across several distinct shows/sessions in one sitting. Host
  // and Player both get a manual "leave"/"join a different game" button
  // on this same SESSION_FINISHED screen (see their own identical
  // checks) precisely because a PERSON is there to click it; Display has
  // no one to click anything, so without this it would sit showing a
  // dead session's "Session ended" card indefinitely — exactly the
  // "stays stuck focused on that session" bug reported against this
  // screen. A real side effect (clearing persisted identity), not
  // derived state, so `useEffect` — not the render-phase-reset pattern
  // used elsewhere in this file — is the right tool; the same class of
  // one-shot timer GameStartingSequence.tsx already uses. Holds on the
  // notice for a few seconds first (this IS the literal video feed the
  // stream audience sees — an instant blank cut would be jarring), then
  // drops back to DisplayConnect on its own, ready for a fresh session
  // code with no one touching the browser at all.
  useEffect(() => {
    if (phase !== "SESSION_FINISHED") return;
    const timeout = setTimeout(clearIdentity, 6000);
    return () => clearTimeout(timeout);
  }, [phase, clearIdentity]);

  // Display is read-only everywhere EXCEPT one button below (a
  // deliberate, later exception to AGENTS.md's original "Session vs.
  // Game phases" write-up) — GAME_FINISHED renders the same hero shell
  // SESSION_LOBBY does, just with the real final score, a winner line
  // instead of 0-0/"WAITING FOR HOST", and "Start next game" wired to
  // `handleStartNext` above. It ALSO still moves on automatically the
  // moment the Host (or another connected Display) actually starts one
  // — a fresh gameId arrives over the same socket broadcast every
  // connected role gets — so this button is a convenience for "no one's
  // at the Host's own keyboard right now," never the only way through.
  // See player/page.tsx's identical check — a fact about this one
  // connection's own seat, independent of `phase`.
  if (kicked) {
    return <KickedNotice onRejoin={clearIdentity} />;
  }

  if (phase === "SESSION_FINISHED") {
    return <SessionEndedNotice />;
  }

  // See player/page.tsx's identical guard — same fix, same reasoning:
  // `synced` (gameStore.ts) is false for a real window on every mount/
  // reload before the catch-up snapshot lands, and without this, Display
  // would flash its own Lobby hero (0-0 score, "WAITING FOR HOST") over
  // whatever real board was actually showing, mid-game, on OBS's own
  // output — never acceptable for a screen the stream audience sees.
  if (!synced) {
    return (
      <div className={styles.hero}>
        <h1 className={`${styles.title} vb-wordmark-transition`}>VIEWERBATTLE</h1>
        <p className={styles.waiting}>SYNCING…</p>
      </div>
    );
  }

  return (
    <>
      {/* Display is the one role nobody sits at a keyboard for (this
          file's own comment above, on the SESSION_FINISHED timeout) — the
          audit's sharpest finding for this screen: THIS tab's own socket
          could sit disconnected/reconnecting for the rest of a stream
          with literally nothing on screen ever changing to say so, since
          `status` (gameStore.ts) was read nowhere on this page. Stacked
          in the same banner row as `HostDisconnectedBanner`, same visual
          language (StatusBanner), silent the instant the connection is
          healthy — no permanent chrome added to a clean OBS capture. */}
      {(!hostConnected || status !== "connected") && (
        <div className={styles.bannerRow}>
          {!hostConnected && <HostDisconnectedBanner />}
          {status === "disconnected" && (
            <StatusBanner title="DISPLAY RECONNECTING…" subtitle="This overlay lost its connection — the score below is frozen until it's back." />
          )}
          {status === "unauthorized" && (
            <StatusBanner tone="danger" title="DISPLAY OFFLINE" subtitle="This display's session is no longer valid — reconnect it from OBS." />
          )}
        </div>
      )}

      {sequenceActive ? (
        <div className={styles.hero}>
          <GameStartingSequence live={phase === "GAME_IN_PROGRESS"} onDone={() => setSequenceActive(false)} />
        </div>
      ) : (
      <>
      {/* `key={phase}` remounts on a real phase change only — the fade is
          a CSS side-effect of real state, never itself the logic (see
          AGENTS.md "Session vs. Game phases"). */}
      {phase === "GAME_IN_PROGRESS" && gameState ? (
        <div key={phase} className={styles.phaseIn}>
          {gameKey === "geoguessr" ? (
            <DisplayGeoPanel state={rawGameState as unknown as GeoGuessrState} />
          ) : gameKey === "drawing" ? (
            <DisplayDrawingPanel state={rawGameState as unknown as DrawingState} requestDrawingSnapshot={requestDrawingSnapshot} />
          ) : gameKey === "music" ? (
            <DisplayMusicPanel state={rawGameState as unknown as MusicState} lastEvents={lastEvents} />
          ) : gameKey === "steamRatings" ? (
            <DisplaySteamPanel state={rawGameState as unknown as SteamRatingsState} lastEvents={lastEvents} />
          ) : gameKey === "guessThePrice" ? (
            <DisplayPricePanel state={rawGameState as unknown as GuessThePriceState} lastEvents={lastEvents} />
          ) : gameKey === "pointingSystem" ? (
            <DisplayPointingPanel state={rawGameState as unknown as PointingSystemState} />
          ) : (
            <DisplayBoardPanel state={rawGameState as unknown as BoardQuestionState} lastEvents={lastEvents} />
          )}
        </div>
      ) : (
        <div key={phase} className={[styles.hero, styles.phaseIn].join(" ")}>
          <h1 className={`${styles.title} vb-wordmark-transition`}>VIEWERBATTLE</h1>

          {/* The running match score — every finished game this session
              has run counts toward it (MatchScore's own doc comment),
              with no fixed lineup and nothing that ever "finishes" a
              show: the Host is free to keep playing as many games as
              they want. */}
          {roster && roster.matchScore.TEAM_A + roster.matchScore.TEAM_B > 0 && (
            <MatchScore teamA={roster.matchScore.TEAM_A} teamB={roster.matchScore.TEAM_B} size="lg" />
          )}

          {phase === "GAME_FINISHED" && gameState ? (
            <WinnerReveal winner={gameState.winner ?? "TIE"} teamAScore={gameState.scores.TEAM_A} teamBScore={gameState.scores.TEAM_B} size="lg" />
          ) : (
            <div className={styles.scoreRow}>
              <span className={styles.scoreA}>0</span>
              <span className={styles.scoreDivider}>—</span>
              <span className={styles.scoreB}>0</span>
            </div>
          )}

          {roster && (
            <div className={styles.rosterRow}>
              <TeamRoster teamName="Team A" variant="teamA" seats={toRosterSeats(roster.teamA, presence, "TEAM_A")} />
              <TeamRoster teamName="Team B" variant="teamB" seats={toRosterSeats(roster.teamB, presence, "TEAM_B")} />
            </div>
          )}

          {phase === "GAME_FINISHED" && !hostConnected ? (
            // Only offered while the Host is genuinely away — the whole
            // point of this one Display action (see `startNext` above and
            // router.ts's matching server check). With a Host connected,
            // the Display waits for them like every other screen.
            <div className={styles.startNextRow}>
              <Button size="lg" loading={startNext.isPending} disabled={!gameKey} onClick={handleStartNext}>
                Start next game →
              </Button>
              {startNext.error && <p className={styles.errorBanner}>{readableSessionError(startNext.error.data?.sessionErrorCode, startNext.error.message)}</p>}
            </div>
          ) : (
            <p className={styles.waiting}>WAITING FOR HOST</p>
          )}
        </div>
      )}
      </>
      )}

      {/* Chat stays up through the countdown, unlike Host/Player — this
          is the persistent OBS overlay, not an interactive screen, so
          there's no "everything replaced by the countdown" moment to be
          consistent with here. */}
      <Card className={styles.chatCard}>
        <CardHeader title="Public chat" />
        <CardBody>
          <GameChatPanel role="DISPLAY" displayName={identity.displayName} participantId={identity.participantId} sendChatMessage={sendChatMessage} />
        </CardBody>
      </Card>
    </>
  );
}
