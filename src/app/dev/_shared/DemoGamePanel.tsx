"use client";

import { useEffect, useState } from "react";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, Card, CardBody, CardHeader, PresenceDot } from "@/ui";
import type { ParticipantRole } from "@/domain/session";
import { useDemoGameStore, type DemoParticipant } from "./demoGameStore";
import { useDevIdentityStore } from "./devIdentityStore";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import styles from "./DemoGamePanel.module.css";

const EXPECTED_PARTICIPANT_COUNT = 6; // Host + 2x Team A + 2x Team B + Display — the fixed Quick Demo roster.

interface Seat {
  participant: DemoParticipant;
  role: ParticipantRole;
  path: string;
  label: string;
}

/**
 * "One click, a full ViewerBattle test game" — composes the exact same
 * tRPC procedures every other tool in this playground uses
 * (session.create, session.join, game.start, session.finish); no new
 * backend surface. The one thing to get right: session.join for two
 * players on the SAME team must not fire truly in parallel, or they race
 * for the same seat and one loses with a spurious TEAM_FULL — see
 * handleCreate below for how the batching avoids that without needing
 * anything from the server beyond what already exists.
 */
export function DemoGamePanel() {
  const demo = useDemoGameStore((state) => state.demo);
  const setDemo = useDemoGameStore((state) => state.setDemo);
  const clearDemo = useDemoGameStore((state) => state.clearDemo);

  const createSession = trpc.session.create.useMutation();
  const joinSession = trpc.session.join.useMutation();
  const startGame = trpc.game.start.useMutation();
  const finishSession = trpc.session.finish.useMutation();

  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Piggybacks on the host's own token to open a real (background) socket
  // connection from this landing page too — the same auth every other
  // tool here uses, not a new mechanism — purely so this card can show
  // who's genuinely connected right now (src/server/sockets/presence.ts),
  // not a guess based on which "Open X" buttons were clicked.
  useGameSocket(demo?.host.token ?? null);
  const connectedParticipants = usePresenceStore((state) => state.participants);
  const connectedIds = new Set(connectedParticipants.map((p) => p.participantId));

  // A demo saved from a previous visit might have been finished some
  // other way (e.g. through /dev/session) or just be old — confirm it's
  // still real before offering "Open X" buttons for it.
  const validity = trpc.session.getState.useQuery(
    { sessionCode: demo?.sessionCode ?? "" },
    { enabled: Boolean(demo), retry: false },
  );
  const isStale = Boolean(demo) && (validity.isError || validity.data?.status === "FINISHED");

  useEffect(() => {
    if (isStale) clearDemo();
  }, [isStale, clearDemo]);

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const session = await createSession.mutateAsync();
      const join = (role: ParticipantRole, displayName: string) =>
        joinSession.mutateAsync({ sessionCode: session.code, role, displayName });

      // Host/Alice/Charlie/Display each claim an independent seat (no two
      // of them can collide), so those four are safe to fire together.
      // Bob and Dave are each the SECOND seat on a team another join in
      // this same batch just claimed — sequencing them after guarantees
      // they see that seat as taken and correctly land on the second one,
      // instead of racing Alice/Charlie for the first.
      const [host, alice, charlie, display] = await Promise.all([
        join("HOST", "Host"),
        join("TEAM_A", "Alice"),
        join("TEAM_B", "Charlie"),
        join("DISPLAY", "OBS Display"),
      ]);
      const [bob, dave] = await Promise.all([join("TEAM_A", "Bob"), join("TEAM_B", "Dave")]);

      await startGame.mutateAsync({ token: host.token, gameKey: "board-question" });

      setDemo({
        sessionCode: session.code,
        host: { id: host.id, token: host.token, displayName: host.displayName },
        teamA: [
          { id: alice.id, token: alice.token, displayName: alice.displayName },
          { id: bob.id, token: bob.token, displayName: bob.displayName },
        ],
        teamB: [
          { id: charlie.id, token: charlie.token, displayName: charlie.displayName },
          { id: dave.id, token: dave.token, displayName: dave.displayName },
        ],
        display: { id: display.id, token: display.token, displayName: display.displayName },
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create the demo game.");
    } finally {
      setCreating(false);
    }
  }

  async function handleReset() {
    if (!demo) return;
    setResetting(true);
    setError(null);
    try {
      await finishSession.mutateAsync({ token: demo.host.token });
      clearDemo();
    } catch (err) {
      const code = err instanceof TRPCClientError ? (err.data as { sessionErrorCode?: string } | undefined)?.sessionErrorCode : undefined;
      // The goal of Reset is "this demo game is gone" — if the backend
      // already agrees (finished by another tab, or the token doesn't
      // resolve to anything anymore), that's success, not failure: clear
      // silently instead of getting stuck offering a Reset button that can
      // never succeed. Anything else is a real failure and must be shown —
      // and must NOT clear the record, or the user loses the only way to
      // retry.
      if (code === "SESSION_CLOSED" || code === "INVALID_TOKEN") {
        clearDemo();
      } else {
        setError(err instanceof Error ? err.message : "Failed to reset the demo game.");
      }
    }
    setResetting(false);
  }

  function openAs(participant: DemoParticipant, role: ParticipantRole, path: string) {
    if (!demo) return;
    // Sets THIS tab's identity, then opens a new tab — same-origin tabs
    // opened via window.open() inherit a copy of the opener's
    // sessionStorage at that moment (standard browser behavior), which is
    // exactly what devIdentityStore is backed by. That's what lets the new
    // tab land on /dev/host etc. already signed in, with zero changes to
    // those pages or to RequireIdentity.
    useDevIdentityStore.getState().setIdentity({
      sessionCode: demo.sessionCode,
      role,
      displayName: participant.displayName,
      token: participant.token,
    });
    window.open(path, "_blank");
  }

  function openAll(seats: Seat[]) {
    // One window.open() per seat, all inside this single click handler —
    // deliberately not deferred (no setTimeout/await between calls):
    // popup blockers key off "was this call still inside a trusted user
    // gesture," and a synchronous loop stays inside that gesture for
    // every call. Each call blocks until its tab exists before the next
    // identity gets written, same ordering guarantee a human clicking
    // the 6 buttons one at a time would get, just without the wait.
    for (const seat of seats) openAs(seat.participant, seat.role, seat.path);
  }

  if (!demo) {
    return (
      <Card variant="raised">
        <CardHeader title="Quick Demo" subtitle="One click, a full ViewerBattle test game" />
        <CardBody>
          <p className={styles.intro}>
            Creates a real session — a Host, two players on Team A, two on Team B, a Display, Mini Jeopardy already
            started — through the exact same session.join / game.start calls every other tool here uses. Nothing
            fake, no tokens to copy.
          </p>
          <div className={styles.createRow}>
            <Button loading={creating} onClick={() => void handleCreate()}>
              Create Demo Game
            </Button>
          </div>
          {error && <p className={styles.errorBanner}>{error}</p>}
        </CardBody>
      </Card>
    );
  }

  const seats: Seat[] = [
    { participant: demo.host, role: "HOST", path: "/dev/host", label: "Host" },
    { participant: demo.teamA[0], role: "TEAM_A", path: "/dev/player", label: demo.teamA[0].displayName },
    { participant: demo.teamA[1], role: "TEAM_A", path: "/dev/player", label: demo.teamA[1].displayName },
    { participant: demo.teamB[0], role: "TEAM_B", path: "/dev/player", label: demo.teamB[0].displayName },
    { participant: demo.teamB[1], role: "TEAM_B", path: "/dev/player", label: demo.teamB[1].displayName },
    { participant: demo.display, role: "DISPLAY", path: "/dev/display", label: "Display" },
  ];

  return (
    <Card variant="raised">
      <CardHeader title="ViewerBattle Demo" />
      <CardBody>
        <div className={styles.sessionRow}>
          <Badge variant="neutral">Session {demo.sessionCode}</Badge>
          {validity.isLoading && <Badge variant="warning">checking…</Badge>}
          <Badge variant={connectedParticipants.length === EXPECTED_PARTICIPANT_COUNT ? "success" : "neutral"} dot>
            {connectedParticipants.length}/{EXPECTED_PARTICIPANT_COUNT} clients connected
          </Badge>
        </div>

        <div className={styles.openAllRow}>
          <Button size="sm" onClick={() => openAll(seats)}>
            Open All 6
          </Button>
        </div>

        <div className={styles.roleGrid}>
          <div className={styles.roleCard}>
            <p className={styles.roleTitle}>Host</p>
            <div className={styles.seatRow}>
              <PresenceDot connected={connectedIds.has(demo.host.id)} />
              <Button size="sm" onClick={() => openAs(demo.host, "HOST", "/dev/host")}>
                Open Host
              </Button>
            </div>
          </div>

          <div className={styles.roleCard}>
            <p className={styles.roleTitle}>Team A</p>
            <div className={styles.playerButtons}>
              {demo.teamA.map((player) => (
                <div key={player.token} className={styles.seatRow}>
                  <PresenceDot connected={connectedIds.has(player.id)} />
                  <Button size="sm" variant="secondary" onClick={() => openAs(player, "TEAM_A", "/dev/player")}>
                    Open as {player.displayName}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.roleCard}>
            <p className={styles.roleTitle}>Team B</p>
            <div className={styles.playerButtons}>
              {demo.teamB.map((player) => (
                <div key={player.token} className={styles.seatRow}>
                  <PresenceDot connected={connectedIds.has(player.id)} />
                  <Button size="sm" variant="secondary" onClick={() => openAs(player, "TEAM_B", "/dev/player")}>
                    Open as {player.displayName}
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className={styles.roleCard}>
            <p className={styles.roleTitle}>Display</p>
            <div className={styles.seatRow}>
              <PresenceDot connected={connectedIds.has(demo.display.id)} />
              <Button size="sm" onClick={() => openAs(demo.display, "DISPLAY", "/dev/display")}>
                Open Display
              </Button>
            </div>
          </div>
        </div>

        {error && <p className={styles.errorBanner}>{error}</p>}

        <div className={styles.footer}>
          <Button variant="danger" size="sm" loading={resetting} onClick={() => void handleReset()}>
            Reset Demo Game
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
