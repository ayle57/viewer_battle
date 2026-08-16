"use client";

import { useState } from "react";
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
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { deriveSessionPhase, readGameStatus } from "@/app/_shared/sessionPhase";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
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

  const joinSession = trpc.session.join.useMutation();

  async function handleJoin() {
    const code = sessionCode.trim().toUpperCase();
    const name = displayName.trim();
    if (!code || !name) return;
    setJoining(true);
    setError(null);
    try {
      const result = await joinSession.mutateAsync({ sessionCode: code, role: "DISPLAY", displayName: name });
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
  const { sendChatMessage } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameKey = useGameStore((state) => state.gameKey);
  const rawGameState = useGameStore((state) => state.gameState);
  const gameState = rawGameState as unknown as GenericGameState | null;
  const lastEvents = useGameStore((state) => state.lastEvents);
  const liveSessionEnded = useGameStore((state) => state.sessionEnded);
  const presence = usePresenceStore((state) => state.participants);
  const hostConnected = presence.some((p) => p.role === "HOST");

  const sessionState = trpc.session.getState.useQuery(
    { sessionCode: identity.sessionCode },
    { refetchInterval: 2000, retry: false },
  );
  const roster = sessionState.data;

  // See host/page.tsx's identical comment — either signal means the
  // session is genuinely gone, not merely marked finished.
  const sessionEnded = liveSessionEnded || sessionState.error?.data?.sessionErrorCode === "SESSION_NOT_FOUND";
  const phase = deriveSessionPhase({ sessionStatus: sessionState.data?.status, gameId, gameStatus: readGameStatus(rawGameState), sessionEnded });

  // No button anywhere on this page by design (AGENTS.md "Session vs.
  // Game phases" — Display is read-only, always) — GAME_FINISHED renders
  // the same hero shell SESSION_LOBBY does, just with the real final
  // score and a winner line instead of 0-0/"WAITING FOR HOST". It moves
  // on to the next game automatically the moment the Host actually
  // starts one (a fresh gameId arrives over the same socket broadcast
  // every other connected role gets), never a local timer pretending to
  // know when that happened.
  if (phase === "SESSION_FINISHED") {
    return <SessionEndedNotice sessionCode={identity.sessionCode} />;
  }

  return (
    <>
      {!hostConnected && (
        <div className={styles.bannerRow}>
          <HostDisconnectedBanner />
        </div>
      )}

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
              <TeamRoster teamName="Team A" variant="teamA" seats={toRosterSeats(roster.teamA, presence)} />
              <TeamRoster teamName="Team B" variant="teamB" seats={toRosterSeats(roster.teamB, presence)} />
            </div>
          )}

          <p className={styles.waiting}>{phase === "GAME_FINISHED" ? "WAITING FOR NEXT GAME" : "WAITING FOR HOST"}</p>
        </div>
      )}

      <Card className={styles.chatCard}>
        <CardHeader title="Public chat" />
        <CardBody>
          <GameChatPanel role="DISPLAY" displayName={identity.displayName} sendChatMessage={sendChatMessage} />
        </CardBody>
      </Card>
    </>
  );
}
