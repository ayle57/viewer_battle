"use client";

import { useState } from "react";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Button, Card, CardBody, CardHeader, Input, TeamRoster } from "@/ui";
import { DisplayBoardPanel } from "@/app/_shared/boardQuestion/DisplayBoardPanel";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { HostDisconnectedBanner } from "@/app/_shared/HostDisconnectedBanner";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";

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
  const gameState = useGameStore((state) => state.gameState);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const presence = usePresenceStore((state) => state.participants);
  const hostConnected = presence.some((p) => p.role === "HOST");

  const sessionState = trpc.session.getState.useQuery(
    { sessionCode: identity.sessionCode },
    { refetchInterval: 2000, retry: false },
  );
  const roster = sessionState.data;

  return (
    <>
      {!hostConnected && (
        <div className={styles.bannerRow}>
          <HostDisconnectedBanner />
        </div>
      )}

      {gameId && gameState ? (
        <DisplayBoardPanel state={gameState as unknown as BoardQuestionState} lastEvents={lastEvents} />
      ) : (
        <div className={styles.hero}>
          <h1 className={styles.title}>VIEWERBATTLE</h1>

          {roster && (
            <div className={styles.rosterRow}>
              <TeamRoster teamName="Team A" variant="teamA" seats={toRosterSeats(roster.teamA, presence)} />
              <TeamRoster teamName="Team B" variant="teamB" seats={toRosterSeats(roster.teamB, presence)} />
            </div>
          )}

          <div className={styles.scoreRow}>
            <span className={styles.scoreA}>0</span>
            <span className={styles.scoreDivider}>—</span>
            <span className={styles.scoreB}>0</span>
          </div>

          <p className={styles.waiting}>WAITING FOR HOST</p>
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
