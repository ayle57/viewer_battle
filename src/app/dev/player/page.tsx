"use client";

import { Badge, Card, CardBody, CardHeader, TeamRoster } from "@/ui";
import { trpc } from "@/app/_trpc/client";
import { PlayerBoardPanel } from "@/app/_shared/boardQuestion/PlayerBoardPanel";
import { ConnectionBadge } from "@/app/_shared/ConnectionBadge";
import { DebugPanel } from "../_shared/DebugPanel";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { RequireIdentity } from "../_shared/RequireIdentity";
import { TodoPanel } from "../_shared/TodoPanel";
import styles from "../_shared/skeletonPage.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { DevIdentity } from "../_shared/devIdentityStore";

export default function PlayerPage() {
  return (
    <main className={styles.page}>
      <h1>Player</h1>
      <p className={styles.hint}>
        Real vertical slice: buzzing sends a real <code>game:action</code>, judged server-side — this page never
        decides for itself whether a buzz was legal, and never sees an answer the server didn&apos;t send it.
      </p>

      <RequireIdentity allow={["TEAM_A", "TEAM_B"]}>{(identity) => <PlayerGame identity={identity} />}</RequireIdentity>
    </main>
  );
}

function PlayerGame({ identity }: { identity: DevIdentity }) {
  const role = identity.role as "TEAM_A" | "TEAM_B";
  const otherTeam = role === "TEAM_A" ? "TEAM_B" : "TEAM_A";
  const rosterVariant: Record<"TEAM_A" | "TEAM_B", "teamA" | "teamB"> = { TEAM_A: "teamA", TEAM_B: "teamB" };
  const { sendAction, sendChatMessage } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameState = useGameStore((state) => state.gameState);
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const presence = usePresenceStore((state) => state.participants);

  const sessionState = trpc.session.getState.useQuery({ sessionCode: identity.sessionCode }, { refetchInterval: 2000, retry: false });
  const roster = sessionState.data;

  return (
    <>
      <div className={styles.hint} style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
        <Badge variant={role === "TEAM_A" ? "teamA" : "teamB"}>{identity.displayName}</Badge>
        <Badge variant="neutral">{role === "TEAM_A" ? "Team A" : "Team B"}</Badge>
        <Badge variant="neutral">Session {identity.sessionCode}</Badge>
        <ConnectionBadge status={status} />
      </div>

      {(!gameId || !gameState) && (
        <>
          <Card>
            <CardBody>
              <p>Waiting for the host to start the game.</p>
            </CardBody>
          </Card>

          {roster && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(12rem, 1fr))", gap: "0.75rem" }}>
              <TeamRoster
                teamName={role === "TEAM_A" ? "Your team — Team A" : "Your team — Team B"}
                variant={rosterVariant[role]}
                seats={toRosterSeats(role === "TEAM_A" ? roster.teamA : roster.teamB, presence)}
                highlightId={presence.find((p) => p.role === role && p.displayName === identity.displayName)?.participantId}
              />
              <TeamRoster
                teamName={otherTeam === "TEAM_A" ? "Opponents — Team A" : "Opponents — Team B"}
                variant={rosterVariant[otherTeam]}
                seats={toRosterSeats(otherTeam === "TEAM_A" ? roster.teamA : roster.teamB, presence)}
              />
            </div>
          )}

          <Card>
            <CardHeader title="Chat" />
            <CardBody>
              <GameChatPanel role={role} displayName={identity.displayName} sendChatMessage={sendChatMessage} />
            </CardBody>
          </Card>
        </>
      )}

      {gameId && gameState && (
        <>
          <PlayerBoardPanel
            state={gameState as unknown as BoardQuestionState}
            role={role}
            lastEvents={lastEvents}
            sendAction={sendAction}
          />
          <Card>
            <CardHeader title="Chat" />
            <CardBody>
              <GameChatPanel role={role} displayName={identity.displayName} sendChatMessage={sendChatMessage} />
            </CardBody>
          </Card>
        </>
      )}

      <DebugPanel>
        <TodoPanel title="Turn timer" description="A visible countdown while your team is answering." blockedBy="not a rule this engine has yet" />
      </DebugPanel>
    </>
  );
}
