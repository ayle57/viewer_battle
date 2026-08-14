"use client";

import { Badge, Button, Card, CardBody, CardHeader } from "@/ui";
import { trpc } from "@/app/_trpc/client";
import { HostBoardPanel } from "../_shared/boardQuestion/HostBoardPanel";
import { ConnectionBadge } from "../_shared/ConnectionBadge";
import { DebugPanel } from "../_shared/DebugPanel";
import { useGameStore } from "../_shared/gameStore";
import { useGameSocket } from "../_shared/useGameSocket";
import { RequireIdentity } from "../_shared/RequireIdentity";
import { TodoPanel } from "../_shared/TodoPanel";
import styles from "../_shared/skeletonPage.module.css";
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
  const { sendAction } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameState = useGameStore((state) => state.gameState);
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);

  const start = trpc.game.start.useMutation();

  return (
    <>
      <div className={styles.hint} style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <Badge variant="host">
          Session {identity.sessionCode} · {identity.displayName}
        </Badge>
        <ConnectionBadge status={status} />
      </div>

      {!gameId && (
        <Card>
          <CardHeader title="No game running" />
          <CardBody>
            <Button
              loading={start.isPending}
              onClick={() => start.mutate({ token: identity.token, gameKey: "board-question" })}
            >
              Start Mini Jeopardy
            </Button>
            {start.error && <p style={{ color: "var(--vb-danger)", marginTop: "0.5rem" }}>{start.error.message}</p>}
          </CardBody>
        </Card>
      )}

      {gameId && gameState && (
        <HostBoardPanel state={gameState as unknown as BoardQuestionState} lastEvents={lastEvents} sendAction={sendAction} />
      )}

      <DebugPanel>
        <TodoPanel
          title="Connected players"
          description="Presence per player (connected/disconnected)."
          blockedBy="presence tracking (separate from game state)"
        />
        <TodoPanel
          title="Timer"
          description="Round/turn timer, host-controlled."
          blockedBy="not a rule this engine has yet"
        />
      </DebugPanel>
    </>
  );
}
