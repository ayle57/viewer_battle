"use client";

import { useState } from "react";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, Card, CardBody, CardHeader, Input, TeamRoster, PresenceDot } from "@/ui";
import { HostBoardPanel } from "@/app/_shared/boardQuestion/HostBoardPanel";
import { ConnectionBadge } from "@/app/_shared/ConnectionBadge";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { SessionCodeBadge } from "@/app/_shared/SessionCodeBadge";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";

export default function HostPage() {
  const identity = useIdentityStore((state) => state.identity);
  return (
    <main className={styles.page}>
      {identity && identity.role === "HOST" ? <HostGame identity={identity} /> : <HostConnexion />}
    </main>
  );
}

/**
 * The one entry point that turns "nobody" into a real HOST identity —
 * isolated here on purpose. Today this is create-a-session + a display
 * name, through the exact same session.create/session.join every other
 * part of the app uses; a real account system later only has to change
 * what calls setIdentity, not anything downstream of it (HostGame,
 * useGameSocket, the board, ...).
 */
function HostConnexion() {
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const createSession = trpc.session.create.useMutation();
  const joinSession = trpc.session.join.useMutation();

  async function handleCreate() {
    const name = displayName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const session = await createSession.mutateAsync();
      const host = await joinSession.mutateAsync({ sessionCode: session.code, role: "HOST", displayName: name });
      setIdentity({ sessionCode: session.code, role: "HOST", displayName: host.displayName, token: host.token });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create the game — try again.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className={styles.connexion}>
      <Card variant="raised">
        <CardHeader title="Host a game" subtitle="ViewerBattle" />
        <CardBody>
          <form
            className={styles.connexionForm}
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreate();
            }}
          >
            <Input
              size="lg"
              label="Your name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Alex"
              autoFocus
            />
            {error && <p className={styles.errorBanner}>{error}</p>}
            <Button size="lg" type="submit" loading={creating} disabled={!displayName.trim()} fullWidth>
              Create Game
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function HostGame({ identity }: { identity: Identity }) {
  const { sendAction, sendChatMessage } = useGameSocket(identity.token);
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const gameId = useGameStore((state) => state.gameId);
  const gameState = useGameStore((state) => state.gameState) as unknown as BoardQuestionState | null;
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const presence = usePresenceStore((state) => state.participants);

  const start = trpc.game.start.useMutation();
  const finish = trpc.session.finish.useMutation();
  const sessionState = trpc.session.getState.useQuery(
    { sessionCode: identity.sessionCode },
    { refetchInterval: 2000, retry: false },
  );

  const roster = sessionState.data;
  const totalRoster = roster ? 1 + roster.teamA.length + roster.teamB.length + roster.displayCount : 0;

  function handleEndSession() {
    finish.mutate(
      { token: identity.token },
      {
        onSettled: () => clearIdentity(),
      },
    );
  }

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <SessionCodeBadge code={identity.sessionCode} />
          <ConnectionBadge status={status} />
          <Badge variant="neutral">
            {presence.length}/{totalRoster || presence.length} connected
          </Badge>
        </div>
        <div className={styles.headerRight}>
          {gameId && gameState && (
            <>
              <Badge variant="teamA">A {gameState.scores.TEAM_A}</Badge>
              <Badge variant="teamB">B {gameState.scores.TEAM_B}</Badge>
            </>
          )}
          <Button variant="ghost" size="sm" loading={finish.isPending} onClick={handleEndSession}>
            End session
          </Button>
        </div>
      </div>

      {(!gameId || !gameState) && (
        <>
          <Card>
            <CardHeader title="Lobby" subtitle="Start whenever you're ready — teams don't need to be full." />
            <CardBody>
              {roster && (
                <div className={styles.rosterGrid}>
                  <div>
                    <p className={styles.hint}>Host</p>
                    <PresenceDot connected={presence.some((p) => p.role === "HOST")} />
                  </div>
                  <TeamRoster teamName="Team A" variant="teamA" seats={toRosterSeats(roster.teamA, presence)} />
                  <TeamRoster teamName="Team B" variant="teamB" seats={toRosterSeats(roster.teamB, presence)} />
                  <div>
                    <p className={styles.hint}>Display</p>
                    <PresenceDot connected={presence.some((p) => p.role === "DISPLAY")} label={`${presence.filter((p) => p.role === "DISPLAY").length} connected`} />
                  </div>
                </div>
              )}
              <div className={styles.startRow}>
                <Button size="lg" loading={start.isPending} onClick={() => start.mutate({ token: identity.token, gameKey: "board-question" })}>
                  Start Game
                </Button>
                {start.error && <p className={styles.errorBanner}>{readableSessionError(start.error.data?.sessionErrorCode, start.error.message)}</p>}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Chat" />
            <CardBody>
              <GameChatPanel role="HOST" displayName={identity.displayName} sendChatMessage={sendChatMessage} />
            </CardBody>
          </Card>
        </>
      )}

      {gameId && gameState && (
        <div className={styles.layout}>
          <div className={styles.main}>
            <HostBoardPanel state={gameState} lastEvents={lastEvents} sendAction={sendAction} />
          </div>
          <div className={styles.sidebar}>
            {roster && (
              <Card>
                <CardHeader title="Roster" />
                <CardBody>
                  <div className={styles.rosterGrid}>
                    <TeamRoster teamName="Team A" variant="teamA" seats={toRosterSeats(roster.teamA, presence)} />
                    <TeamRoster teamName="Team B" variant="teamB" seats={toRosterSeats(roster.teamB, presence)} />
                  </div>
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader title="Chat" />
              <CardBody>
                <GameChatPanel role="HOST" displayName={identity.displayName} sendChatMessage={sendChatMessage} />
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
