"use client";

import { trpc } from "@/app/_trpc/client";
import { Card, CardHeader, CardBody, TeamRoster } from "@/ui";
import { DisplayBoardPanel } from "@/app/_shared/boardQuestion/DisplayBoardPanel";
import { DebugPanel } from "../_shared/DebugPanel";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { RequireIdentity } from "../_shared/RequireIdentity";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { DevIdentity } from "../_shared/devIdentityStore";

export default function DisplayPage() {
  return (
    <main className={styles.page}>
      <RequireIdentity allow={["DISPLAY"]}>{(identity) => <DisplayGame identity={identity} />}</RequireIdentity>

      <DebugPanel>
        <p>
          Read-only, built for OBS capture. Joined in the DISPLAY role — structurally unable to submit any{" "}
          <code>game:action</code>, and the server never sends this role an answer, regardless of anything this page
          does.
        </p>
      </DebugPanel>
    </main>
  );
}

function DisplayGame({ identity }: { identity: DevIdentity }) {
  const { sendChatMessage } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameState = useGameStore((state) => state.gameState);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const presence = usePresenceStore((state) => state.participants);

  const sessionState = trpc.session.getState.useQuery({ sessionCode: identity.sessionCode }, { refetchInterval: 2000, retry: false });
  const roster = sessionState.data;

  return (
    <>
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

      {/* Public chat, strictly read-only for DISPLAY (canPostToChannel already
          rejects it server-side; `disabled` here is UX, not the permission
          boundary) — secondary to the main capture area on purpose. */}
      <Card className={styles.chatCard}>
        <CardHeader title="Public chat" />
        <CardBody>
          <GameChatPanel role="DISPLAY" displayName={identity.displayName} sendChatMessage={sendChatMessage} />
        </CardBody>
      </Card>
    </>
  );
}
