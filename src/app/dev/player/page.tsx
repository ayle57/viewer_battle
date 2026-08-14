"use client";

import { Badge, Card, CardBody } from "@/ui";
import { PlayerBoardPanel } from "../_shared/boardQuestion/PlayerBoardPanel";
import { ConnectionBadge } from "../_shared/ConnectionBadge";
import { DebugPanel } from "../_shared/DebugPanel";
import { useGameStore } from "../_shared/gameStore";
import { useGameSocket } from "../_shared/useGameSocket";
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
  const { sendAction } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameState = useGameStore((state) => state.gameState);
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);

  return (
    <>
      <div className={styles.hint} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <Badge variant={identity.role === "TEAM_A" ? "teamA" : "teamB"}>
          Session {identity.sessionCode} · {identity.displayName}
        </Badge>
        <ConnectionBadge status={status} />
      </div>

      {!gameId && (
        <Card>
          <CardBody>
            <p>No game running yet — waiting for the host to start Mini Jeopardy.</p>
          </CardBody>
        </Card>
      )}

      {gameId && gameState && (
        <PlayerBoardPanel
          state={gameState as unknown as BoardQuestionState}
          role={identity.role as "TEAM_A" | "TEAM_B"}
          lastEvents={lastEvents}
          sendAction={sendAction}
        />
      )}

      <DebugPanel>
        <TodoPanel
          title="Presence"
          description="Which teammates and opponents are currently connected."
          blockedBy="presence tracking (separate from game state)"
        />
      </DebugPanel>
    </>
  );
}
