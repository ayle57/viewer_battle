"use client";

import { Badge } from "@/ui";
import { RequireIdentity } from "../_shared/RequireIdentity";
import { TodoPanel } from "../_shared/TodoPanel";
import styles from "../_shared/skeletonPage.module.css";

export default function HostPage() {
  return (
    <main className={styles.page}>
      <h1>Host</h1>
      <p className={styles.hint}>
        Skeleton — will grow into the real host control panel as each backend piece lands. Nothing below is faked;
        panels say TODO until there is a real feature to show.
      </p>

      <RequireIdentity allow={["HOST"]}>
        {(identity) => (
          <>
            <Badge variant="host">
              Session {identity.sessionCode} · {identity.displayName}
            </Badge>
            <div className={styles.grid}>
              <TodoPanel
                title="Teams"
                description="List of teams in this session, names and scores."
                blockedBy="Team/Player schema"
              />
              <TodoPanel
                title="Connected players"
                description="Presence per player (connected/disconnected), tied to real socket connections."
                blockedBy="Player identity + presence tracking"
              />
              <TodoPanel title="Chat" description="Embed the real chat panel scoped to this session." blockedBy="wiring shared chat hook here" />
              <TodoPanel
                title="Game state"
                description="Current game/round from the Game Kernel for this session."
                blockedBy="src/domain/game (Game Kernel)"
              />
              <TodoPanel title="Score" description="Live team scores as the game reports them." blockedBy="Game Kernel + score model" />
              <TodoPanel title="Timer" description="Round/turn timer, host-controlled." blockedBy="Game Kernel timer support" />
              <TodoPanel
                title="Host actions"
                description="Start/pause/skip round, force scoring, kick a player, etc."
                blockedBy="real session/game tRPC + socket events"
              />
              <TodoPanel
                title="Realtime events"
                description="Raw event log of everything broadcast to this session, for debugging."
                blockedBy="Game Kernel event stream"
              />
            </div>
          </>
        )}
      </RequireIdentity>
    </main>
  );
}
