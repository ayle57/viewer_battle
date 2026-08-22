"use client";

import { Badge, Button, Card, CardBody, CardHeader, TeamRoster, PresenceDot } from "@/ui";
import { trpc } from "@/app/_trpc/client";
import { HostBoardPanel } from "@/app/_shared/boardQuestion/HostBoardPanel";
import { ConnectionBadge } from "@/app/_shared/ConnectionBadge";
import { DebugPanel } from "../_shared/DebugPanel";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { SessionCodeBadge } from "@/app/_shared/SessionCodeBadge";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { RequireIdentity } from "../_shared/RequireIdentity";
import { TodoPanel } from "../_shared/TodoPanel";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { DevIdentity } from "../_shared/devIdentityStore";

export default function HostPage() {
  return (
    <main className={styles.page}>
      <h1>Host</h1>
      <p className={styles.hint}>
        Real control panel: every click below is a real <code>game:action</code> over Socket.IO, judged by{" "}
        <code>src/domain/game/boardQuestion</code> and persisted before anything broadcasts back.
      </p>

      <RequireIdentity allow={["HOST"]}>{(identity) => <HostGame identity={identity} />}</RequireIdentity>
    </main>
  );
}

function HostGame({ identity }: { identity: DevIdentity }) {
  const { sendAction, sendChatMessage } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameState = useGameStore((state) => state.gameState) as unknown as BoardQuestionState | null;
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const presence = usePresenceStore((state) => state.participants);

  const start = trpc.game.start.useMutation();
  const sessionState = trpc.session.getState.useQuery({ sessionCode: identity.sessionCode }, { refetchInterval: 2000, retry: false });

  const roster = sessionState.data;
  const totalRoster = roster ? (roster.host ? 1 : 0) + roster.teamA.length + roster.teamB.length + roster.displayCount : 0;

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <SessionCodeBadge code={identity.sessionCode} />
          <ConnectionBadge status={status} />
          <Badge variant="neutral">{presence.length}/{totalRoster || presence.length} connected</Badge>
        </div>
        {gameId && gameState && (
          <div className={styles.headerRight}>
            {/* Compact on purpose — the full ScoreDisplay already anchors HostBoardPanel below; repeating it here at full size would just be the same number twice. */}
            <Badge variant="teamA">A {gameState.scores.TEAM_A}</Badge>
            <Badge variant="teamB">B {gameState.scores.TEAM_B}</Badge>
          </div>
        )}
      </div>

      {(!gameId || !gameState) && (
        <>
          <Card>
            <CardHeader title="Waiting for players" subtitle="Start whenever you're ready — teams don't need to be full." />
            <CardBody>
              {roster && (
                <div className={styles.rosterGrid}>
                  <div>
                    <p className={styles.hint}>Host</p>
                    <PresenceDot connected={presence.some((p) => p.role === "HOST")} />
                  </div>
                  <TeamRoster teamName="Team A" variant="teamA" seats={toRosterSeats(roster.teamA, presence, "TEAM_A")} />
                  <TeamRoster teamName="Team B" variant="teamB" seats={toRosterSeats(roster.teamB, presence, "TEAM_B")} />
                  <div>
                    <p className={styles.hint}>Display</p>
                    <PresenceDot connected={presence.some((p) => p.role === "DISPLAY")} />
                  </div>
                </div>
              )}
              <div style={{ marginTop: "1rem" }}>
                <Button
                  loading={start.isPending}
                  onClick={() => start.mutate({ token: identity.token, gameKey: "board-question" })}
                >
                  Start Game
                </Button>
                {start.error && <p style={{ color: "var(--vb-danger)", marginTop: "0.5rem" }}>{start.error.message}</p>}
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
                    <TeamRoster teamName="Team A" variant="teamA" seats={toRosterSeats(roster.teamA, presence, "TEAM_A")} />
                    <TeamRoster teamName="Team B" variant="teamB" seats={toRosterSeats(roster.teamB, presence, "TEAM_B")} />
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

      <DebugPanel>
        <TodoPanel title="Timer" description="Round/turn timer, host-controlled." blockedBy="not a rule this engine has yet" />
      </DebugPanel>
    </>
  );
}
