"use client";

import { useState } from "react";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Badge, Button, Card, CardBody, CardHeader, Input, TeamRoster } from "@/ui";
import { PlayerBoardPanel } from "@/app/_shared/boardQuestion/PlayerBoardPanel";
import { ConnectionBadge } from "@/app/_shared/ConnectionBadge";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { HostDisconnectedBanner } from "@/app/_shared/HostDisconnectedBanner";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";

export default function PlayerPage() {
  const identity = useIdentityStore((state) => state.identity);
  return (
    <main className={styles.page}>
      {identity && (identity.role === "TEAM_A" || identity.role === "TEAM_B") ? (
        <PlayerGame identity={identity} />
      ) : (
        <PlayerJoin />
      )}
    </main>
  );
}

/**
 * The one entry point that turns "nobody" into a real TEAM_A/TEAM_B
 * identity — the form is always visible (there's nothing secret about
 * it), the actual gate is server-side: session.join rejects a fresh join
 * with HOST_NOT_CONNECTED if the host isn't genuinely connected yet, no
 * matter what this form shows.
 */
function PlayerJoin() {
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const [sessionCode, setSessionCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [team, setTeam] = useState<"TEAM_A" | "TEAM_B">("TEAM_A");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const joinSession = trpc.session.join.useMutation();

  async function handleJoin() {
    const code = sessionCode.trim().toUpperCase();
    const name = displayName.trim();
    if (!code || !name) return;
    setJoining(true);
    setError(null);
    try {
      const result = await joinSession.mutateAsync({ sessionCode: code, role: team, displayName: name });
      setIdentity({ sessionCode: code, role: team, displayName: result.displayName, token: result.token });
    } catch (err) {
      const code = err instanceof TRPCClientError ? err.data?.sessionErrorCode : undefined;
      setError(readableSessionError(code, err instanceof Error ? err.message : "Couldn't join — try again."));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className={styles.join}>
      <Card variant="raised">
        <CardHeader title="Join a game" subtitle="ViewerBattle" />
        <CardBody>
          <form
            className={styles.joinForm}
            onSubmit={(event) => {
              event.preventDefault();
              void handleJoin();
            }}
          >
            <Input
              size="lg"
              label="Session code"
              value={sessionCode}
              onChange={(event) => setSessionCode(event.target.value)}
              placeholder="e.g. X7K2QP"
              autoFocus
            />
            <Input
              size="lg"
              label="Your name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Jamie"
            />
            <div className={styles.teamChoice}>
              <p className={styles.teamChoiceLabel}>Team</p>
              <div className={styles.teamButtons}>
                <button
                  type="button"
                  className={[styles.teamButton, styles.teamA, team === "TEAM_A" && styles.teamButtonActive].filter(Boolean).join(" ")}
                  aria-pressed={team === "TEAM_A"}
                  onClick={() => setTeam("TEAM_A")}
                >
                  Team A
                </button>
                <button
                  type="button"
                  className={[styles.teamButton, styles.teamB, team === "TEAM_B" && styles.teamButtonActive].filter(Boolean).join(" ")}
                  aria-pressed={team === "TEAM_B"}
                  onClick={() => setTeam("TEAM_B")}
                >
                  Team B
                </button>
              </div>
            </div>
            {error && <p className={styles.errorBanner}>{error}</p>}
            <Button size="lg" type="submit" loading={joining} disabled={!sessionCode.trim() || !displayName.trim()} fullWidth>
              Join
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

function PlayerGame({ identity }: { identity: Identity }) {
  const role = identity.role as "TEAM_A" | "TEAM_B";
  const otherTeam = role === "TEAM_A" ? "TEAM_B" : "TEAM_A";
  const rosterVariant: Record<"TEAM_A" | "TEAM_B", "teamA" | "teamB"> = { TEAM_A: "teamA", TEAM_B: "teamB" };
  const { sendAction, sendChatMessage } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameState = useGameStore((state) => state.gameState);
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const presence = usePresenceStore((state) => state.participants);
  const hostConnected = presence.some((p) => p.role === "HOST");

  const sessionState = trpc.session.getState.useQuery(
    { sessionCode: identity.sessionCode },
    { refetchInterval: 2000, retry: false },
  );
  const roster = sessionState.data;

  return (
    <>
      <div className={styles.header}>
        <Badge variant={role === "TEAM_A" ? "teamA" : "teamB"}>{identity.displayName}</Badge>
        <Badge variant="neutral">{role === "TEAM_A" ? "Team A" : "Team B"}</Badge>
        <Badge variant="neutral">Session {identity.sessionCode}</Badge>
        <ConnectionBadge status={status} />
      </div>

      {!hostConnected && <HostDisconnectedBanner />}

      {(!gameId || !gameState) && (
        <>
          <Card>
            <CardBody>
              <p>Waiting for the host to start the game.</p>
            </CardBody>
          </Card>

          {roster && (
            <div className={styles.rosterRow}>
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
    </>
  );
}
