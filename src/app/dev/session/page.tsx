"use client";

import { useState } from "react";
import Link from "next/link";
import type { ParticipantRole } from "@/domain/session";
import { Badge, Button, Card, CardBody, CardHeader, Input, ScoreDisplay, TeamRoster, PresenceDot } from "@/ui";
import { trpc } from "@/app/_trpc/client";
import { useDevIdentityStore, type DevIdentity } from "../_shared/devIdentityStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { useGameStore } from "@/app/_shared/gameStore";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { SessionCodeBadge } from "@/app/_shared/SessionCodeBadge";
import { ROLE_LABEL } from "@/app/_shared/roleLabels";
import { DebugPanel } from "../_shared/DebugPanel";
import styles from "./page.module.css";

export default function SessionPage() {
  const identity = useDevIdentityStore((state) => state.identity);
  const setIdentity = useDevIdentityStore((state) => state.setIdentity);
  const clearIdentity = useDevIdentityStore((state) => state.clearIdentity);

  const [sessionCode, setSessionCode] = useState(identity?.sessionCode ?? "");
  const [role, setRole] = useState<ParticipantRole>(identity?.role ?? "HOST");
  const [displayName, setDisplayName] = useState(identity?.displayName ?? "");

  const create = trpc.session.create.useMutation({
    onSuccess: (session) => setSessionCode(session.code),
  });
  const join = trpc.session.join.useMutation({
    onSuccess: (result) => {
      setIdentity({
        sessionCode: result.sessionCode,
        role: result.role,
        displayName: result.displayName,
        token: result.token,
      });
    },
  });

  function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const code = sessionCode.trim();
    const name = displayName.trim();
    if (!code || !name) return;
    join.mutate({ sessionCode: code, role, displayName: name, token: identity?.token });
  }

  const joinErrorCode = join.error?.data?.sessionErrorCode;

  return (
    <main className={styles.page}>
      <h1>Session</h1>
      <p className={styles.hint}>
        Real session lifecycle — <code>session.create</code>/<code>session.join</code>/<code>session.getState</code>{" "}
        via tRPC → Prisma → Postgres, real presence over Socket.IO, real capacity limits enforced server-side (see
        AGENTS.md &quot;Session invariants&quot;). Quick Demo (on <Link href="/dev">/dev</Link>) is the fast path for
        a full 6-client game; this tool is for joining/creating by hand — a real identity, real seats, real
        presence, edge cases Quick Demo skips.
      </p>

      {identity && <Lobby identity={identity} onClearIdentity={clearIdentity} />}

      <Card>
        <CardHeader title="Create a session" />
        <CardBody>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Create new session
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={identity ? "Switch identity" : "Join a session"} />
        <CardBody>
          <form className={styles.form} onSubmit={handleJoin}>
            <Input
              label="Session code"
              value={sessionCode}
              onChange={(event) => setSessionCode(event.target.value)}
              placeholder="e.g. X7K2QP"
            />
            <div className={styles.selectField}>
              <label className={styles.selectLabel} htmlFor="role">
                Role
              </label>
              <select
                id="role"
                className={styles.select}
                value={role}
                onChange={(event) => setRole(event.target.value as ParticipantRole)}
              >
                {(Object.keys(ROLE_LABEL) as ParticipantRole[]).map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Jamie"
            />
            {join.error && (
              <p className={styles.errorBanner}>
                {joinErrorCode ? `${joinErrorCode} — ` : ""}
                {join.error.message}
              </p>
            )}
            <Button type="submit" loading={join.isPending} disabled={!sessionCode.trim() || !displayName.trim()}>
              {identity ? "Update identity" : "Join session"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </main>
  );
}

function Lobby({ identity, onClearIdentity }: { identity: DevIdentity; onClearIdentity: () => void }) {
  useGameSocket(identity.token); // opens the one real-time connection for this tab — presence + a possible already-started game
  const gameId = useGameStore((state) => state.gameId);
  const gameState = useGameStore((state) => state.gameState) as { phase?: string; scores?: { TEAM_A: number; TEAM_B: number } } | null;
  const presence = usePresenceStore((state) => state.participants);

  const state = trpc.session.getState.useQuery({ sessionCode: identity.sessionCode }, { refetchInterval: 2000, retry: false });
  const startGame = trpc.game.start.useMutation();
  const finishSession = trpc.session.finish.useMutation();

  if (!state.data) {
    return (
      <Card variant="raised">
        <CardBody>
          <p className={styles.hint}>Loading session…</p>
        </CardBody>
      </Card>
    );
  }

  const teamASeats = toRosterSeats(state.data.teamA, presence);
  const teamBSeats = toRosterSeats(state.data.teamB, presence);
  const hostConnected = state.data.host ? presence.some((p) => p.participantId === state.data.host!.id) : false;
  const displayConnectedCount = presence.filter((p) => p.role === "DISPLAY").length;

  const statusLabel =
    state.data.status === "FINISHED" ? "Finished" : gameId ? "Game in progress" : "Waiting for players";

  return (
    <Card variant="raised">
      <CardHeader
        title={<SessionCodeBadge code={identity.sessionCode} />}
        subtitle={`You: ${identity.displayName} · ${ROLE_LABEL[identity.role]}`}
      />
      <CardBody>
        <div className={styles.currentRow}>
          <Badge variant={statusLabel === "Finished" ? "neutral" : statusLabel === "Game in progress" ? "success" : "warning"}>
            {statusLabel}
          </Badge>
          <Button size="sm" variant="ghost" onClick={onClearIdentity}>
            Clear identity
          </Button>
          {identity.role === "HOST" && state.data.status !== "FINISHED" && (
            <Button
              size="sm"
              variant="danger"
              loading={finishSession.isPending}
              onClick={() => finishSession.mutate({ token: identity.token })}
            >
              Finish session
            </Button>
          )}
        </div>

        {gameId && gameState ? (
          <div className={styles.stateGrid} style={{ marginTop: "1rem" }}>
            <ScoreDisplay
              teamAName="Team A"
              teamAScore={gameState.scores?.TEAM_A ?? 0}
              teamBName="Team B"
              teamBScore={gameState.scores?.TEAM_B ?? 0}
              label={`Phase: ${gameState.phase ?? "?"}`}
            />
          </div>
        ) : (
          <div className={styles.stateGrid} style={{ marginTop: "1rem" }}>
            <div className={styles.slot}>
              <span>Host</span>
              {state.data.host ? (
                <div className={styles.currentRow}>
                  <Badge variant="host">{state.data.host.displayName}</Badge>
                  <PresenceDot connected={hostConnected} />
                </div>
              ) : (
                <span className={styles.slotEmpty}>empty</span>
              )}
            </div>

            <TeamRoster teamName="Team A" variant="teamA" seats={teamASeats} highlightId={undefined} />
            <TeamRoster teamName="Team B" variant="teamB" seats={teamBSeats} highlightId={undefined} />

            <div className={styles.slot}>
              <span>Display</span>
              <PresenceDot connected={displayConnectedCount > 0} label={`${displayConnectedCount} connected`} />
            </div>
          </div>
        )}

        {identity.role === "HOST" && !gameId && state.data.status !== "FINISHED" && (
          <div className={styles.currentRow} style={{ marginTop: "1rem" }}>
            <Button
              loading={startGame.isPending}
              onClick={() => startGame.mutate({ token: identity.token, gameKey: "board-question" })}
            >
              Start Game
            </Button>
            {startGame.error && <p className={styles.errorBanner}>{startGame.error.message}</p>}
          </div>
        )}

        <DebugPanel title="Jump to a tool">
          <div className={styles.jumpGrid}>
            <Link href="/dev/chat">
              <Button variant="secondary" size="sm">
                Chat
              </Button>
            </Link>
            <Link href="/dev/host">
              <Button variant="secondary" size="sm">
                Host
              </Button>
            </Link>
            <Link href="/dev/player">
              <Button variant="secondary" size="sm">
                Player
              </Button>
            </Link>
            <Link href="/dev/display">
              <Button variant="secondary" size="sm">
                Display
              </Button>
            </Link>
          </div>
        </DebugPanel>
      </CardBody>
    </Card>
  );
}
