"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Input, Tabs, TeamRoster, PresenceDot } from "@/ui";
import { HostBoardPanel } from "@/app/_shared/boardQuestion/HostBoardPanel";
import { PreviousGameCard } from "@/app/_shared/boardQuestion/PreviousGameCard";
import { WinnerReveal } from "@/app/_shared/boardQuestion/WinnerReveal";
import { ConnectionBadge } from "@/app/_shared/ConnectionBadge";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { GameStartingSequence } from "@/app/_shared/GameStartingSequence";
import { LobbyStatus, type LobbyStatusValue } from "@/app/_shared/LobbyStatus";
import { MatchScore } from "@/app/_shared/MatchScore";
import { SessionCodeBadge } from "@/app/_shared/SessionCodeBadge";
import { SessionEndedNotice } from "@/app/_shared/SessionEndedNotice";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { deriveSessionPhase, readGameStatus } from "@/app/_shared/sessionPhase";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import { listGameDefinitions, type GameKey } from "@/domain/game";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";

export default function HostPage() {
  const identity = useIdentityStore((state) => state.identity);
  return (
    <main className={styles.page}>
      {identity && identity.role === "HOST" ? <HostGame identity={identity} /> : <HostConnexion />}
    </main>
  );
}

/**
 * The one entry point that turns "nobody" into a real HOST identity —
 * isolated here on purpose. Today this is create-a-session + a display
 * name, through the exact same session.create/session.join every other
 * part of the app uses; a real account system later only has to change
 * what calls setIdentity, not anything downstream of it (HostGame,
 * useGameSocket, the board, ...).
 *
 * Two tabs, not one form: "New game" (create + join, the common case) and
 * "Reconnect" (session.reclaimHost — recovers the HOST seat with the
 * one-time recovery key instead of the lost bearer token). Host identity
 * only lives in sessionStorage (identityStore.ts), so closing the tab —
 * not just reloading it — genuinely loses it; without this second tab a
 * host in that spot would be permanently locked out of a session that's
 * still live for every other connected participant.
 */
function HostConnexion() {
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const [pendingReveal, setPendingReveal] = useState<{ hostKey: string; identity: Identity } | null>(null);

  if (pendingReveal) {
    return (
      <SaveHostKey
        hostKey={pendingReveal.hostKey}
        sessionCode={pendingReveal.identity.sessionCode}
        onContinue={() => setIdentity(pendingReveal.identity)}
      />
    );
  }

  return (
    <div className={styles.connexion}>
      <Card variant="raised">
        <CardHeader title="Host a game" subtitle="ViewerBattle" />
        <CardBody>
          <Tabs
            items={[
              { value: "create", label: "New game", content: <CreateGameForm onCreated={setPendingReveal} /> },
              { value: "reclaim", label: "Reconnect", content: <ReclaimHostForm onReclaimed={setIdentity} /> },
            ]}
          />
        </CardBody>
      </Card>
    </div>
  );
}

function CreateGameForm({ onCreated }: { onCreated: (reveal: { hostKey: string; identity: Identity }) => void }) {
  const [displayName, setDisplayName] = useState("");
  const [hostPassword, setHostPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const createSession = trpc.session.create.useMutation();
  const joinSession = trpc.session.join.useMutation();

  async function handleCreate() {
    const name = displayName.trim();
    const password = hostPassword.trim();
    if (!name || !password) return;
    setCreating(true);
    setError(null);
    try {
      const session = await createSession.mutateAsync({ hostPassword: password });
      const host = await joinSession.mutateAsync({ sessionCode: session.code, role: "HOST", displayName: name });
      onCreated({
        hostKey: session.hostKey,
        identity: { sessionCode: session.code, role: "HOST", displayName: host.displayName, token: host.token },
      });
    } catch (err) {
      const errorCode = err instanceof TRPCClientError ? err.data?.sessionErrorCode : undefined;
      setError(readableSessionError(errorCode, err instanceof Error ? err.message : "Couldn't create the game — try again."));
    } finally {
      setCreating(false);
    }
  }

  return (
    <form
      className={styles.connexionForm}
      onSubmit={(event) => {
        event.preventDefault();
        void handleCreate();
      }}
    >
      <Input
        size="lg"
        label="Your name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        placeholder="e.g. Alex"
        autoFocus
      />
      <Input
        size="lg"
        type="password"
        label="Host password"
        value={hostPassword}
        onChange={(event) => setHostPassword(event.target.value)}
        placeholder="Only the streamer knows this"
      />
      {error && <p className={styles.errorBanner}>{error}</p>}
      <Button size="lg" type="submit" loading={creating} disabled={!displayName.trim() || !hostPassword.trim()} fullWidth>
        Create Game
      </Button>
    </form>
  );
}

/**
 * Recovers the HOST seat of an already-existing session with the
 * recovery key from SaveHostKey below, instead of session.join's `token`
 * (which the host, by definition, no longer has here). Rotates the
 * seat's token server-side (reclaimHost, src/server/db/participant.ts) —
 * this stays possible even while a game is in progress and other
 * participants are still connected, that's the entire point.
 */
function ReclaimHostForm({ onReclaimed }: { onReclaimed: (identity: Identity) => void }) {
  const [sessionCode, setSessionCode] = useState("");
  const [hostKey, setHostKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reclaiming, setReclaiming] = useState(false);

  const reclaimHost = trpc.session.reclaimHost.useMutation();

  async function handleReclaim() {
    const code = sessionCode.trim().toUpperCase();
    const key = hostKey.trim();
    const name = displayName.trim();
    if (!code || !key || !name) return;
    setReclaiming(true);
    setError(null);
    try {
      const host = await reclaimHost.mutateAsync({ sessionCode: code, hostKey: key, displayName: name });
      onReclaimed({ sessionCode: host.sessionCode, role: "HOST", displayName: host.displayName, token: host.token });
    } catch (err) {
      const errorCode = err instanceof TRPCClientError ? err.data?.sessionErrorCode : undefined;
      setError(readableSessionError(errorCode, err instanceof Error ? err.message : "Couldn't reconnect — try again."));
    } finally {
      setReclaiming(false);
    }
  }

  return (
    <form
      className={styles.connexionForm}
      onSubmit={(event) => {
        event.preventDefault();
        void handleReclaim();
      }}
    >
      <p className={styles.hint}>Lost your host tab? Use the recovery key you saved when you created this game.</p>
      <Input
        size="lg"
        label="Session code"
        value={sessionCode}
        onChange={(event) => setSessionCode(event.target.value)}
        placeholder="e.g. X7K2QP"
      />
      <Input
        size="lg"
        label="Recovery key"
        value={hostKey}
        onChange={(event) => setHostKey(event.target.value)}
        placeholder="e.g. AB3D-EFGH-2JKM"
      />
      <Input
        size="lg"
        label="Your name"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        placeholder="e.g. Alex"
      />
      {error && <p className={styles.errorBanner}>{error}</p>}
      <Button
        size="lg"
        type="submit"
        loading={reclaiming}
        disabled={!sessionCode.trim() || !hostKey.trim() || !displayName.trim()}
        fullWidth
      >
        Reconnect as host
      </Button>
    </form>
  );
}

/**
 * The one and only place the host recovery key is ever shown in
 * plaintext — session.create returns it once, nothing persists it
 * client-side, and the server only ever kept its hash. Blocks entry into
 * the game until the host acknowledges saving it, same reasoning as any
 * "here is your recovery code, write it down" flow: showing it once in a
 * toast that scrolls away is the same as never showing it.
 */
function SaveHostKey({ hostKey, sessionCode, onContinue }: { hostKey: string; sessionCode: string; onContinue: () => void }) {
  const [copied, setCopied] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(hostKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied or unavailable — the key is still
      // right there, selectable by hand.
    }
  }

  return (
    <div className={styles.connexion}>
      <Card variant="raised">
        <CardHeader title="Save your recovery key" subtitle={`Session ${sessionCode}`} />
        <CardBody>
          <p className={styles.hint}>
            If you close this tab or lose connection, this key is the only way to reconnect as host without ending the
            game for everyone else. It won&apos;t be shown again.
          </p>
          <div className={styles.hostKeyBox}>{hostKey}</div>
          <div className={styles.connexionForm}>
            <Button variant="secondary" onClick={() => void copy()} fullWidth>
              {copied ? "Copied!" : "Copy recovery key"}
            </Button>
            <label className={styles.acknowledgeRow}>
              <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
              I&apos;ve saved my recovery key
            </label>
            <Button size="lg" disabled={!acknowledged} onClick={onContinue} fullWidth>
              Continue to game
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function HostGame({ identity }: { identity: Identity }) {
  const { sendAction, sendChatMessage } = useGameSocket(identity.token);
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const gameId = useGameStore((state) => state.gameId);
  const rawGameState = useGameStore((state) => state.gameState);
  const gameState = rawGameState as unknown as BoardQuestionState | null;
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const liveSessionEnded = useGameStore((state) => state.sessionEnded);
  const presence = usePresenceStore((state) => state.participants);

  const start = trpc.game.start.useMutation();
  const finish = trpc.session.finish.useMutation();
  const sessionState = trpc.session.getState.useQuery(
    { sessionCode: identity.sessionCode },
    { refetchInterval: 2000, retry: false },
  );

  const roster = sessionState.data;
  const totalRoster = roster ? 1 + roster.teamA.length + roster.teamB.length + roster.displayCount : 0;

  // `liveSessionEnded` (a real-time socket push) or the poll itself
  // 404ing (SESSION_NOT_FOUND — this tab reconnected after the session
  // was already deleted, missing the live push) both mean the same
  // thing: there's no session left to show. See sessionPhase.ts.
  const sessionEnded = liveSessionEnded || sessionState.error?.data?.sessionErrorCode === "SESSION_NOT_FOUND";
  const phase = deriveSessionPhase({ sessionStatus: sessionState.data?.status, gameId, gameStatus: readGameStatus(rawGameState), sessionEnded });

  // Purely a local VIEW toggle within the GAME_FINISHED phase — "which of
  // two truthful renderings of the same phase (results splash vs. the
  // lobby) is the host currently looking at," never a claim about which
  // PHASE the session is in (that's `phase` above, always freshly
  // derived). Scoped to a specific gameId, not a plain boolean, so a
  // brand new game (a fresh gameId arriving via broadcast) always starts
  // back on "not yet acknowledged" — see AGENTS.md "Session vs. Game
  // phases" for why this is safe where a fake isGameOver-style flag
  // wouldn't be.
  const [acknowledgedGameId, setAcknowledgedGameId] = useState<string | null>(null);
  const showResultsSplash = phase === "GAME_FINISHED" && acknowledgedGameId !== gameId;

  const games = listGameDefinitions();
  // Genuinely selectable, not hardcoded — today `games` has exactly one
  // entry (board-question) so this is pre-selected and effectively fixed,
  // but the Host actually picks it via the UI below, and adding a second
  // registered engine needs no rewiring here. `GameKey` (registry.ts) is
  // `string` — deliberate type erasure, the registry can't know every
  // engine's shape statically — so `start.mutate` below still narrows
  // with one explicit cast to the literal `game.start`'s tRPC schema
  // currently accepts; see AGENTS.md "Session vs. Game phases" for why
  // that schema staying a literal (not widened to GameKey) is the one
  // deliberate change still owed to whenever a second engine exists.
  const [selectedGameKey, setSelectedGameKey] = useState<GameKey>(games[0]?.id ?? "board-question");
  const startLabel = phase === "GAME_FINISHED" ? "Start Next Game" : "Start Game";

  const [forgetOpen, setForgetOpen] = useState(false);
  const [endSessionOpen, setEndSessionOpen] = useState(false);

  function handleEndSession() {
    finish.mutate(
      { token: identity.token },
      {
        onSettled: () => clearIdentity(),
      },
    );
  }

  // Shared by the Lobby's "Start Game"/"Start Next Game" button and the
  // results splash's "Play Again" — same mutation, same selected game,
  // two entry points. Nothing to reconcile afterward: `game.start`
  // broadcasts the fresh game:state to every connected client (see
  // src/server/trpc/router.ts), which is what actually flips `phase` to
  // GAME_IN_PROGRESS and makes the splash disappear on its own.
  //
  // `sequenceActive` gates the READY->3->2->1->LIVE moment
  // (GameStartingSequence.tsx) — set the instant the click happens (a
  // real user action). Cleared by that component's own `onDone`, which
  // itself waits for the real `phase` to reach GAME_IN_PROGRESS (see its
  // doc comment); `showStartSequence` additionally drops it the moment
  // the mutation genuinely fails (derived directly from `start.isError`
  // during render, not synced back via a setState-in-effect), so a real
  // error never leaves the host stuck staring at a countdown for a game
  // that didn't start — retrying just calls `start.mutate` again, which
  // clears `isError` on its own and brings the sequence right back.
  const [sequenceActive, setSequenceActive] = useState(false);
  const showStartSequence = sequenceActive && !start.isError;
  const lobbyStatus: LobbyStatusValue = showStartSequence ? "starting" : "ready";

  function handleStartGame() {
    setSequenceActive(true);
    start.mutate({ token: identity.token, gameKey: selectedGameKey as "board-question" });
  }

  if (phase === "SESSION_FINISHED") {
    return (
      <>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <Link href="/" className={`${styles.brandMark} vb-wordmark-transition`}>VIEWERBATTLE</Link>
            <SessionCodeBadge code={identity.sessionCode} />
          </div>
        </div>
        <SessionEndedNotice sessionCode={identity.sessionCode} />
        <div className={styles.startRow}>
          <Button size="lg" onClick={clearIdentity}>
            Start a new game
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={`${styles.brandMark} vb-wordmark-transition`}>VIEWERBATTLE</Link>
          <SessionCodeBadge code={identity.sessionCode} />
          <ConnectionBadge status={status} />
          <Badge variant="neutral">
            {presence.length}/{totalRoster || presence.length} connected
          </Badge>
          {(phase === "SESSION_LOBBY" || (phase === "GAME_FINISHED" && !showResultsSplash)) && (
            <LobbyStatus value={lobbyStatus} />
          )}
          {roster && roster.matchScore.TEAM_A + roster.matchScore.TEAM_B > 0 && (
            <MatchScore teamA={roster.matchScore.TEAM_A} teamB={roster.matchScore.TEAM_B} />
          )}
        </div>
        <div className={styles.headerRight}>
          {gameId && gameState && (
            <div className={styles.headerScores}>
              <Badge variant="teamA">A {gameState.scores.TEAM_A}</Badge>
              <Badge variant="teamB">B {gameState.scores.TEAM_B}</Badge>
            </div>
          )}
          {/* A visually separate cluster from the status/score badges
              above — these are the two ways to leave this screen, one
              harmless (local-only) and one that ends the show for
              everyone; keeping them physically apart from "what's
              happening right now" info is itself the ergonomics fix,
              not just which one gets the danger color. The danger color
              belongs to the one that's actually irreversible and affects
              everyone else watching — "End session" — not the local-only
              one, which is the opposite of what this looked like before. */}
          <div className={styles.headerActions}>
            {/* Local-only — clears THIS browser's identity, never touches
                the session server-side. For "I'm testing and want a
                completely new show" without kicking the players/display
                still connected to the old one, which "End session" would.
                The old session (and its roster) stays exactly as it was —
                the saved recovery key gets back into it via the Reconnect
                tab on this same page. Confirmed, not instant — losing the
                only path back into a live show by a stray click is a real
                cost, worth one extra step to avoid, even though the
                action itself is harmless. */}
            <Button variant="ghost" size="sm" onClick={() => setForgetOpen(true)}>
              Forget this session
            </Button>
            {/* Deletes the session for real (src/server/db/session.ts's
                endSession) — every player and the display still watching
                get kicked to "Session ended" in real time, and the
                session code stops working for anyone. Genuinely
                irreversible, hence danger + its own confirmation, unlike
                "Forget" above. */}
            <Button variant="danger" size="sm" onClick={() => setEndSessionOpen(true)}>
              End session
            </Button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={forgetOpen}
        title="Forget this session?"
        description="This removes the session from this device only. It will not end the show, and it will not disconnect the players or display still watching."
        confirmLabel="Forget session"
        onCancel={() => setForgetOpen(false)}
        onConfirm={clearIdentity}
      />

      <ConfirmDialog
        open={endSessionOpen}
        title="End this session?"
        description="This ends the show for everyone — every player and the display still watching are disconnected immediately, and this session code stops working. This can't be undone."
        confirmLabel="End session"
        danger
        confirming={finish.isPending}
        onCancel={() => setEndSessionOpen(false)}
        onConfirm={() => {
          setEndSessionOpen(false);
          handleEndSession();
        }}
      />

      {showStartSequence ? (
        <Card variant="raised">
          <CardBody>
            <GameStartingSequence live={phase === "GAME_IN_PROGRESS"} onDone={() => setSequenceActive(false)} />
          </CardBody>
        </Card>
      ) : (
      /* `key={phase}` remounts this wrapper whenever the real derived
         phase changes, replaying the fade-in — a CSS side-effect of a
         real state transition (see AGENTS.md "Session vs. Game phases"),
         never itself a decision about what to show. Reduced-motion is
         handled globally (src/ui/tokens.css), nothing per-usage needed
         here. */
      <div key={`${phase}-${showResultsSplash}`} className={styles.phaseIn}>
      {gameId && gameState && showResultsSplash && (
        <Card variant="raised" className={styles.resultsCard}>
          <CardBody>
            <WinnerReveal winner={gameState.winner ?? "TIE"} teamAScore={gameState.scores.TEAM_A} teamBScore={gameState.scores.TEAM_B} />
            <div className={styles.resultsActions}>
              <Button size="lg" onClick={handleStartGame}>
                Play Again
              </Button>
              <Button size="lg" variant="ghost" onClick={() => setAcknowledgedGameId(gameId)}>
                Back to Lobby
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      {(phase === "SESSION_LOBBY" || (phase === "GAME_FINISHED" && !showResultsSplash)) && (
        <>
          {phase === "GAME_FINISHED" && gameState && <PreviousGameCard gameLabel="Mini Jeopardy" state={gameState} />}

          <Card>
            <CardHeader title="Lobby" subtitle="Start whenever you're ready — teams don't need to be full." />
            <CardBody>
              {roster && (
                <div className={styles.rosterGrid}>
                  <div>
                    <p className={styles.hint}>Host</p>
                    <PresenceDot connected={presence.some((p) => p.role === "HOST")} />
                  </div>
                  <TeamRoster teamName="Team A" variant="teamA" seats={toRosterSeats(roster.teamA, presence)} />
                  <TeamRoster teamName="Team B" variant="teamB" seats={toRosterSeats(roster.teamB, presence)} />
                  <div>
                    <p className={styles.hint}>Display</p>
                    <PresenceDot connected={presence.some((p) => p.role === "DISPLAY")} label={`${presence.filter((p) => p.role === "DISPLAY").length} connected`} />
                  </div>
                </div>
              )}

              <div className={styles.gameSelection} role="radiogroup" aria-label="Choose a game">
                <p className={styles.gameSelectionLabel}>Select a game</p>
                <div className={styles.gameCardGrid}>
                  {games.map((game) => {
                    const selected = selectedGameKey === game.id;
                    return (
                      <label
                        key={game.id}
                        className={[styles.gameCard, selected && styles.gameCardSelected].filter(Boolean).join(" ")}
                      >
                        <input
                          type="radio"
                          name="gameKey"
                          value={game.id}
                          checked={selected}
                          onChange={() => setSelectedGameKey(game.id)}
                          className={styles.gameCardRadio}
                        />
                        {selected && <span className={styles.gameCardChip}>SELECTED</span>}
                        <p className={styles.gameCardTitle}>{game.label}</p>
                        {game.meta && <p className={styles.gameCardMeta}>{game.meta}</p>}
                        <p className={styles.gameCardStatus}>
                          <span className={styles.gameCardStatusDot} aria-hidden="true" />
                          Available
                        </p>
                      </label>
                    );
                  })}
                  <div className={[styles.gameCard, styles.gameCardComingSoon].join(" ")}>
                    <p className={styles.gameCardTitle}>More games</p>
                    <p className={styles.gameCardMeta}>New formats for the same room, same stream.</p>
                    <p className={styles.gameCardStatus}>Coming soon</p>
                  </div>
                </div>
              </div>

              {/* `sequenceActive` (GameStartingSequence, rendered above
                  this whole phase-driven block once it's true — see
                  below) takes over the instant this button is clicked,
                  so in practice this plain row is what's showing
                  whenever the Lobby itself is visible. */}
              <div className={styles.startRow}>
                <Button size="lg" onClick={handleStartGame}>
                  {startLabel}
                </Button>
                {start.error && <p className={styles.errorBanner}>{readableSessionError(start.error.data?.sessionErrorCode, start.error.message)}</p>}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Chat" />
            <CardBody>
              <GameChatPanel role="HOST" displayName={identity.displayName} sendChatMessage={sendChatMessage} />
            </CardBody>
          </Card>
        </>
      )}

      {phase === "GAME_IN_PROGRESS" && gameState && (
        <div className={styles.layout}>
          <div className={styles.main}>
            <HostBoardPanel state={gameState} lastEvents={lastEvents} sendAction={sendAction} />
          </div>
          <div className={styles.sidebar}>
            {roster && (
              <Card>
                <CardHeader title="Roster" />
                <CardBody>
                  <div className={styles.rosterGrid}>
                    <TeamRoster teamName="Team A" variant="teamA" seats={toRosterSeats(roster.teamA, presence)} />
                    <TeamRoster teamName="Team B" variant="teamB" seats={toRosterSeats(roster.teamB, presence)} />
                  </div>
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader title="Chat" />
              <CardBody>
                <GameChatPanel role="HOST" displayName={identity.displayName} sendChatMessage={sendChatMessage} />
              </CardBody>
            </Card>
          </div>
        </div>
      )}
      </div>
      )}
    </>
  );
}
