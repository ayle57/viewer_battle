"use client";

import { Card, CardBody } from "@/ui";
import { DisplayBoardPanel } from "../_shared/boardQuestion/DisplayBoardPanel";
import { useGameStore } from "../_shared/gameStore";
import { useGameSocket } from "../_shared/useGameSocket";
import { RequireIdentity } from "../_shared/RequireIdentity";
import styles from "../_shared/skeletonPage.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { DevIdentity } from "../_shared/devIdentityStore";

export default function DisplayPage() {
  return (
    <main className={styles.page}>
      <h1>Display</h1>
      <p className={styles.hint}>
        Read-only, built for OBS capture. Joined in the DISPLAY role — structurally unable to submit any{" "}
        <code>game:action</code>, and the server never sends this role an answer, regardless of anything this page
        does.
      </p>

      <RequireIdentity allow={["DISPLAY"]}>{(identity) => <DisplayGame identity={identity} />}</RequireIdentity>
    </main>
  );
}

function DisplayGame({ identity }: { identity: DevIdentity }) {
  useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameState = useGameStore((state) => state.gameState);
  const lastEvents = useGameStore((state) => state.lastEvents);

  if (!gameId || !gameState) {
    return (
      <Card>
        <CardBody>
          <p>No game running yet.</p>
        </CardBody>
      </Card>
    );
  }

  return <DisplayBoardPanel state={gameState as unknown as BoardQuestionState} lastEvents={lastEvents} />;
}
