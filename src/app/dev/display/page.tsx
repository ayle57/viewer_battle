"use client";

import { Badge } from "@/ui";
import { RequireIdentity } from "../_shared/RequireIdentity";
import { TodoPanel } from "../_shared/TodoPanel";
import styles from "../_shared/skeletonPage.module.css";

export default function DisplayPage() {
  return (
    <main className={styles.page}>
      <h1>Display</h1>
      <p className={styles.hint}>
        Skeleton — simulates the OBS browser-source overlay. Joins the real session in the DISPLAY role, so it is
        already read-only for real (enforced by src/domain/chat/permissions, not a UI-only restriction) — see
        /dev/chat with a DISPLAY identity today.
      </p>

      <RequireIdentity allow={["DISPLAY"]}>
        {(identity) => (
          <>
            <Badge variant="display">Session {identity.sessionCode}</Badge>
            <div className={styles.grid}>
              <TodoPanel
                title="Public session state"
                description="Whatever is safe to broadcast publicly (session name/status)."
                blockedBy="Session schema beyond code + timestamps"
              />
              <TodoPanel title="Teams" description="Team names, read-only." blockedBy="Team/Player schema" />
              <TodoPanel title="Scores" description="Live scoreboard." blockedBy="Game Kernel + score model" />
              <TodoPanel title="Timer" description="Round/turn countdown, host-controlled." blockedBy="Game Kernel timer support" />
              <TodoPanel
                title="Game state"
                description="The public-facing view of the current game (not the host/player private views)."
                blockedBy="src/domain/game (Game Kernel)"
              />
              <TodoPanel
                title="Public events"
                description="Announcements, round transitions — whatever the game broadcasts to PUBLIC."
                blockedBy="Game Kernel event stream"
              />
            </div>
          </>
        )}
      </RequireIdentity>
    </main>
  );
}
