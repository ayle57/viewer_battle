"use client";

import { Badge } from "@/ui";
import { RequireIdentity } from "../_shared/RequireIdentity";
import { TodoPanel } from "../_shared/TodoPanel";
import styles from "../_shared/skeletonPage.module.css";

export default function PlayerPage() {
  return (
    <main className={styles.page}>
      <h1>Player</h1>
      <p className={styles.hint}>
        Skeleton — will grow into the real player view as each backend piece lands. Nothing below is faked; panels
        say TODO until there is a real feature to show.
      </p>

      <RequireIdentity allow={["TEAM_A", "TEAM_B"]}>
        {(identity) => (
          <>
            <Badge variant={identity.role === "TEAM_A" ? "teamA" : "teamB"}>
              Session {identity.sessionCode} · {identity.displayName}
            </Badge>
            <div className={styles.grid}>
              <TodoPanel
                title="Connection"
                description="Real Socket.IO connection status and reconnection already exist today — see /dev/chat's status badge. Will surface here directly next."
              />
              <TodoPanel
                title="Presence"
                description="Which teammates and opponents are currently connected."
                blockedBy="Player identity + presence tracking"
              />
              <TodoPanel title="Chat" description="Embed the real chat panel scoped to this session." blockedBy="wiring shared chat hook here" />
              <TodoPanel
                title="Game state"
                description="What this player currently sees/needs to respond to."
                blockedBy="src/domain/game (Game Kernel)"
              />
              <TodoPanel
                title="Available actions"
                description="Buttons for whatever the current game state allows (buzz in, answer, draw, ...)."
                blockedBy="Game Kernel + per-game action schemas"
              />
              <TodoPanel title="Score" description="This player's team score, live." blockedBy="Game Kernel + score model" />
              <TodoPanel
                title="Errors / reconnection"
                description="Surfaced action failures and what happens to in-flight state on reconnect."
                blockedBy="Game Kernel action handling"
              />
            </div>
          </>
        )}
      </RequireIdentity>
    </main>
  );
}
