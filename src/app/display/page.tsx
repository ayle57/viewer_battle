"use client";

import { useEffect, useState } from "react";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Button, Card, CardBody, CardHeader, Input, TeamRoster } from "@/ui";
import { DisplayBoardPanel } from "@/app/_shared/boardQuestion/DisplayBoardPanel";
import { DisplayGeoPanel } from "@/app/_shared/geoGuessr/DisplayGeoPanel";
import { MatchScore } from "@/app/_shared/MatchScore";
import { WinnerReveal } from "@/app/_shared/boardQuestion/WinnerReveal";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { HostDisconnectedBanner } from "@/app/_shared/HostDisconnectedBanner";
import { SessionEndedNotice } from "@/app/_shared/SessionEndedNotice";
import { KickedNotice } from "@/app/_shared/KickedNotice";
import { GameStartingSequence } from "@/app/_shared/GameStartingSequence";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { deriveSessionPhase, readGameStatus } from "@/app/_shared/sessionPhase";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
import { getLastDisplayName, saveLastDisplayName, clearLastDisplayName } from "@/app/_shared/lastDisplayName";
import { RememberedNameHint } from "@/app/_shared/RememberedNameHint";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import type { Scoreboard } from "@/domain/game";
import type { TeamRole } from "@/domain/session";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";

/** See host/page.tsx's identical type — the generic slice WinnerReveal needs, without either engine's full state type. */
type GenericGameState = { scores: Scoreboard; winner: TeamRole | "TIE" | null };

export default function DisplayPage() {
  const identity = useIdentityStore((state) => state.identity);
  return (
    <main className={styles.page}>
      {identity && identity.role === "DISPLAY" ? <DisplayGame identity={identity} /> : <DisplayConnect />}
    </main>
  );
}

/**
 * The one entry point that turns "nobody" into a real DISPLAY identity.
 * No team choice (Display isn't on a team) — just a code and a name so
 * OBS logs/whoever's watching this connection can tell which display it
 * is if there's more than one.
 */
function DisplayConnect() {
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const [sessionCode, setSessionCode] = useState("");
  const [displayName, setDisplayName] = useState("OBS Display");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // See PlayerJoin's identical field — RememberedNameHint below is what
  // this drives.
  const [remembered, setRemembered] = useState<string | null>(null);

  // Real, reported friction — see PlayerJoin's identical effect (src/app/
  // player/page.tsx) for the full doc comment on why this is a
  // post-mount effect, not a `useState` initializer. Only overrides the
  // "OBS Display" placeholder if a real remembered name actually exists.
  useEffect(() => {
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
  }, []);

  function logOutRememberedName() {
    clearLastDisplayName("display");
    setRemembered(null);
    setDisplayName("");
  }

  const joinSession = trpc.session.join.useMutation();

  async function handleJoin() {
    const code = sessionCode.trim().toUpperCase();
    const name = displayName.trim();
    if (!code || !name) return;
    setJoining(true);
    setError(null);
    try {
      const result = await joinSession.mutateAsync({ sessionCode: code, role: "DISPLAY", displayName: name });
      saveLastDisplayName("display", name);
      setIdentity({ sessionCode: code, role: "DISPLAY", displayName: result.displayName, token: result.token });
    } catch (err) {
      const code = err instanceof TRPCClientError ? err.data?.sessionErrorCode : undefined;
      setError(readableSessionError(code, err instanceof Error ? err.message : "Couldn't connect — try again."));
    } finally {
      setJoining(false);
    }
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
              void handleJoin();
            }}
          >
            <Input
              size="lg"
              label="Session code"
              value={sessionCode}
              onChange={(event) => setSessionCode(event.target.value)}
              placeholder="e.g. X7K2QP"
              autoFocus
            />
            <Input
              size="lg"
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
            {remembered && displayName === remembered && <RememberedNameHint name={remembered} onLogout={logOutRememberedName} />}
            {error && <p className={styles.errorBanner}>{error}</p>}
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
  const { sendChatMessage } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameKey = useGameStore((state) => state.gameKey);
  const rawGameState = useGameStore((state) => state.gameState);
  const gameState = rawGameState as unknown as GenericGameState | null;
  const lastEvents = useGameStore((state) => state.lastEvents);
  const liveSessionEnded = useGameStore((state) => state.sessionEnded);
  const kicked = useGameStore((state) => state.kicked);
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
  const [prevPhase, setPrevPhase] = useState(phase);
  const [sequenceActive, setSequenceActive] = useState(false);
  if (prevPhase !== phase) {
    if (phase === "GAME_IN_PROGRESS" && prevPhase !== "GAME_IN_PROGRESS") setSequenceActive(true);
    setPrevPhase(phase);
  }

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

  return (
    <>
      {!hostConnected && (
        <div className={styles.bannerRow}>
          <HostDisconnectedBanner />
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

          {phase === "GAME_FINISHED" ? (
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
          <GameChatPanel role="DISPLAY" displayName={identity.displayName} sendChatMessage={sendChatMessage} />
        </CardBody>
      </Card>
    </>
  );
}
