"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Input, TeamRoster } from "@/ui";
import { PlayerBoardPanel } from "@/app/_shared/boardQuestion/PlayerBoardPanel";
import { PreviousGameCard } from "@/app/_shared/boardQuestion/PreviousGameCard";
import { PlayerGeoPanel } from "@/app/_shared/geoGuessr/PlayerGeoPanel";
import { ConnectionBadge } from "@/app/_shared/ConnectionBadge";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { HostDisconnectedBanner } from "@/app/_shared/HostDisconnectedBanner";
import { LobbyStatus } from "@/app/_shared/LobbyStatus";
import { MatchScore } from "@/app/_shared/MatchScore";
import { SessionEndedNotice } from "@/app/_shared/SessionEndedNotice";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { deriveSessionPhase, readGameStatus } from "@/app/_shared/sessionPhase";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import { listGameDefinitions } from "@/domain/game";
import type { Scoreboard } from "@/domain/game";
import type { TeamRole } from "@/domain/session";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";

/** See host/page.tsx's identical type — the generic slice PreviousGameCard needs, without either engine's full state type. */
type GenericGameState = { scores: Scoreboard; winner: TeamRole | "TIE" | null };

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
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const { sendAction, sendChatMessage } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameKey = useGameStore((state) => state.gameKey);
  const rawGameState = useGameStore((state) => state.gameState);
  const gameState = rawGameState as unknown as GenericGameState | null;
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const liveSessionEnded = useGameStore((state) => state.sessionEnded);
  const presence = usePresenceStore((state) => state.participants);
  const hostConnected = presence.some((p) => p.role === "HOST");

  const sessionState = trpc.session.getState.useQuery(
    { sessionCode: identity.sessionCode },
    { refetchInterval: 2000, retry: false },
  );
  const roster = sessionState.data;

  // See host/page.tsx's identical comment — either signal means the
  // session is genuinely gone, not merely marked finished.
  const sessionEnded = liveSessionEnded || sessionState.error?.data?.sessionErrorCode === "SESSION_NOT_FOUND";
  const phase = deriveSessionPhase({ sessionStatus: sessionState.data?.status, gameId, gameStatus: readGameStatus(rawGameState), sessionEnded });
  const [forgetOpen, setForgetOpen] = useState(false);

  if (phase === "SESSION_FINISHED") {
    return (
      <>
        <div className={styles.header}>
          <Link href="/" className={`${styles.brandMark} vb-wordmark-transition`}>VIEWERBATTLE</Link>
          <Badge variant={role === "TEAM_A" ? "teamA" : "teamB"}>{identity.displayName}</Badge>
          <Badge variant="neutral">Session {identity.sessionCode}</Badge>
        </div>
        <SessionEndedNotice sessionCode={identity.sessionCode} />
        <div className={styles.startRow}>
          <Button variant="ghost" onClick={clearIdentity}>
            Join a different game
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.header}>
        <Link href="/" className={`${styles.brandMark} vb-wordmark-transition`}>VIEWERBATTLE</Link>
        <Badge variant={role === "TEAM_A" ? "teamA" : "teamB"}>{identity.displayName}</Badge>
        <Badge variant="neutral">{role === "TEAM_A" ? "Team A" : "Team B"}</Badge>
        <Badge variant="neutral">Session {identity.sessionCode}</Badge>
        <ConnectionBadge status={status} />
        {roster && roster.matchScore.TEAM_A + roster.matchScore.TEAM_B > 0 && (
          <MatchScore teamA={roster.matchScore.TEAM_A} teamB={roster.matchScore.TEAM_B} />
        )}
        {/* Local-only, same as Host's "Forget this session" — leaves this
            browser's seat as-is server-side (still occupied, still
            reconnectable with the original token), just stops showing it
            here. For "wrong game, let me join a different one" without
            needing to clear cookies/storage by hand. Confirmed, not
            instant — a stray tap mid-buzz shouldn't be able to boot you
            out of the game you're actively playing. */}
        <Button variant="danger" size="sm" onClick={() => setForgetOpen(true)}>
          Not your game?
        </Button>
      </div>

      <ConfirmDialog
        open={forgetOpen}
        title="Forget this session?"
        description="This removes the session from this device only. It won't free up your seat — your team, the host, and the display all keep seeing you as connected until you close this tab for good."
        confirmLabel="Forget session"
        danger
        onCancel={() => setForgetOpen(false)}
        onConfirm={clearIdentity}
      />

      {!hostConnected && <HostDisconnectedBanner />}

      {/* `key={phase}` remounts this wrapper whenever the real derived
          phase changes, replaying the fade-in — a CSS side-effect of a
          real state transition, never itself a decision about what to
          show (see AGENTS.md "Session vs. Game phases"). */}
      <div key={phase} className={styles.phaseIn}>
      {(phase === "SESSION_LOBBY" || phase === "GAME_FINISHED") && (
        <>
          <div className={styles.statusRow}>
            <LobbyStatus value={hostConnected ? "ready" : "waiting-for-host"} />
          </div>

          {phase === "GAME_FINISHED" && gameState && (
            <PreviousGameCard gameLabel={listGameDefinitions().find((g) => g.id === gameKey)?.label ?? "Game"} state={gameState} />
          )}

          <Card>
            <CardBody>
              <p>{phase === "GAME_FINISHED" ? "Waiting for the host to start the next game." : "Waiting for the host to start the game."}</p>
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

      {phase === "GAME_IN_PROGRESS" && gameState && (
        <>
          {gameKey === "geoguessr" ? (
            <PlayerGeoPanel state={rawGameState as unknown as GeoGuessrState} role={role} sendAction={sendAction} />
          ) : (
            <PlayerBoardPanel state={rawGameState as unknown as BoardQuestionState} role={role} lastEvents={lastEvents} sendAction={sendAction} />
          )}
          <Card>
            <CardHeader title="Chat" />
            <CardBody>
              <GameChatPanel role={role} displayName={identity.displayName} sendChatMessage={sendChatMessage} />
            </CardBody>
          </Card>
        </>
      )}
      </div>
    </>
  );
}
