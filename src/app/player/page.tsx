"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Button, ConfirmDialog, Input, TeamRoster } from "@/ui";
import { PlayerBoardPanel } from "@/app/_shared/boardQuestion/PlayerBoardPanel";
import { WinnerReveal } from "@/app/_shared/boardQuestion/WinnerReveal";
import { PlayerGeoPanel } from "@/app/_shared/geoGuessr/PlayerGeoPanel";
import { PlayerDrawingPanel } from "@/app/_shared/drawing/PlayerDrawingPanel";
import { PlayerMusicPanel } from "@/app/_shared/music/PlayerMusicPanel";
import { PlayerSteamPanel } from "@/app/_shared/steamRatings/PlayerSteamPanel";
import { PlayerPricePanel } from "@/app/_shared/guessThePrice/PlayerPricePanel";
import { PlayerPointingPanel } from "@/app/_shared/pointingSystem/PlayerPointingPanel";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { useChatStore } from "@/app/_shared/chatStore";
import { channelsForRole, type ChatChannel } from "@/domain/chat";
import { GameStartingSequence } from "@/app/_shared/GameStartingSequence";
import { HostDisconnectedBanner } from "@/app/_shared/HostDisconnectedBanner";
import { StatusBanner } from "@/app/_shared/StatusBanner";
import { ConnectionBadge } from "@/app/_shared/ConnectionBadge";
import { SessionEndedNotice } from "@/app/_shared/SessionEndedNotice";
import { KickedNotice } from "@/app/_shared/KickedNotice";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { deriveSessionPhase, readGameStatus } from "@/app/_shared/sessionPhase";
import { useGameStartingSequence } from "@/app/_shared/useGameStartingSequence";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
import { getLastDisplayName, saveLastDisplayName, clearLastDisplayName, playerScope, getLastTeam, saveLastTeam } from "@/app/_shared/lastDisplayName";
import { RememberedNameHint } from "@/app/_shared/RememberedNameHint";
import { useAccountStore } from "@/app/_shared/accountStore";
import { AccountBadge } from "@/app/_shared/AccountBadge";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import type { Scoreboard } from "@/domain/game";
import type { TeamRole } from "@/domain/session";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";
import type { DrawingState } from "@/domain/game/drawing";
import type { MusicState } from "@/domain/game/music";
import type { SteamRatingsState } from "@/domain/game/steamRatings";
import type { GuessThePriceState } from "@/domain/game/guessThePrice";
import type { PointingSystemState } from "@/domain/game/pointingSystem";

/** See host/page.tsx's identical type — the generic slice WinnerReveal needs, without either engine's full state type. */
type GenericGameState = { scores: Scoreboard; winner: TeamRole | "TIE" | null };

export default function PlayerPage() {
  const identity = useIdentityStore((state) => state.identity);
  return (
    // `vb-dark-scope` (tokens.css) — the Player route's own always-dark
    // "premium gameshow" identity, applied once here at the root so
    // every descendant (including shared components also used by Host/
    // Display — Card, Badge, Button, SessionEndedNotice, KickedNotice,
    // TeamRoster, chat…) re-themes for free off the SAME dark palette
    // tokens.css already ships for `:root[data-theme="dark"]`, with zero
    // changes to any of those components themselves. See tokens.css's
    // own doc comment on this class.
    <main className={`${styles.page} vb-dark-scope`}>
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
  const account = useAccountStore((state) => state.account);
  const [sessionCode, setSessionCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [team, setTeam] = useState<"TEAM_A" | "TEAM_B">("TEAM_A");
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  // Tracks whatever name was actually remembered (not just what's in the
  // field right now) so `RememberedNameHint` below only shows up while
  // the field still holds the untouched prefill — see that component's
  // own doc comment for why this is "compte provisoire," not silent
  // autofill, and lastDisplayName.ts's `clearLastDisplayName` for the
  // real bug ("j'ai le même pseudo partout") this closes.
  const [remembered, setRemembered] = useState<string | null>(null);

  // Real, reported friction: finishing a game and starting a fresh one
  // always reset the team picker back to Team A by default, even for
  // someone who'd been playing Team B all night — a `useEffect`, not a
  // `useState` initializer, for the exact same SSR-hydration reason the
  // name prefill below is one too (localStorage isn't available during
  // SSR, and reading it in the initializer would make the server-rendered
  // markup disagree with the client's first real render). Mount-only —
  // this is a one-time default, not something that should keep re-forcing
  // itself if the player then clicks the other team button themselves.
  useEffect(() => {
    const lastTeam = getLastTeam();
    if (lastTeam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeam(lastTeam);
    }
  }, []);

  // Real, reported friction: finishing a game and joining a fresh one
  // (or just coming back another day) meant retyping the exact same
  // name every single time. `useEffect`, not a `useState` initializer —
  // `localStorage` isn't available during SSR, and reading it in the
  // initializer would make the server-rendered markup (always empty)
  // disagree with the client's first real render, a hydration mismatch
  // (same class of bug this app's own `useReducedMotionSafe` exists to
  // avoid).
  //
  // Also re-runs on every TEAM switch, not just on mount — a REAL,
  // REPORTED bug this closes ("j'ai joué en tant que test3 et... ça a
  // mis test2"): solo testing both seats from the same browser (or a
  // streamer prepping Team A then Team B before real players arrive)
  // used to leak whichever team was joined LAST into the OTHER team's
  // own field, because both taught the same single "player" scope (see
  // lastDisplayName.ts's own doc comment). The overwrite guard is now
  // "still empty, OR still holding exactly what was remembered for the
  // team just switched AWAY from" — that second clause is what makes a
  // team switch actually SWAP the prefill instead of only ever filling
  // an empty field once; anything else means the player genuinely typed
  // their own name, which a team click must never clobber.
  useEffect(() => {
    // A real account (accountStore.ts) supersedes the plain "remembered
    // name" convenience entirely — a logged-in viewer's pseudo IS their
    // account username, not a silently-guessed-at localStorage value
    // that could be wrong (see RememberedNameHint's own doc comment on
    // that exact failure mode). No `remembered`/hint shown in this case:
    // there's nothing to "log out of" here, that's what a real account
    // logout (on /account) is for.
    if (account) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDisplayName((current) => current || account.username);
      return;
    }
    // A genuine read of an external system (localStorage) on mount AND
    // on every team switch — not a subscription with an ongoing value to
    // track, so there's no render-phase equivalent (PageChangeCurtain.tsx's
    // own comment on that pattern) to reach for instead here.
    const stored = getLastDisplayName(playerScope(team));
    setDisplayName((current) => (!current || current === remembered ? stored || "" : current));
    setRemembered(stored || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `remembered` deliberately excluded: read here as the PREVIOUS render's value (whichever team was just switched away from) to detect an untouched prefill; including it would make this effect re-fire on its own write
  }, [account, team]);

  function logOutRememberedName() {
    clearLastDisplayName(playerScope(team));
    setRemembered(null);
    setDisplayName("");
  }

  const joinSession = trpc.session.join.useMutation();

  async function handleJoin() {
    const code = sessionCode.trim().toUpperCase();
    const name = displayName.trim();
    if (!code || !name) return;
    setJoining(true);
    setError(null);
    try {
      const result = await joinSession.mutateAsync({ sessionCode: code, role: team, displayName: name, accountToken: account?.token });
      saveLastDisplayName(playerScope(team), name);
      saveLastTeam(team);
      setIdentity({ sessionCode: code, role: team, displayName: result.displayName, token: result.token, participantId: result.id });
    } catch (err) {
      const code = err instanceof TRPCClientError ? err.data?.sessionErrorCode : undefined;
      setError(readableSessionError(code, err instanceof Error ? err.message : "Couldn't join — try again."));
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className={styles.join}>
      <div className={styles.joinBrand}>
        <Link href="/" className={`${styles.joinWordmark} vb-wordmark-transition`}>
          VIEWERBATTLE
        </Link>
        <p className={styles.joinTagline}>Enter the code your host gave you.</p>
        <div className={styles.accountRow}>
          <AccountBadge />
        </div>
      </div>
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
        {remembered && displayName === remembered && <RememberedNameHint name={remembered} onLogout={logOutRememberedName} />}
        <div className={styles.teamChoice}>
          <p className={styles.teamChoiceLabel}>Team</p>
          <div className={styles.teamButtons}>
            <button
              type="button"
              className={[styles.teamButton, team === "TEAM_A" && styles.teamButtonActive, team === "TEAM_A" && styles.teamA].filter(Boolean).join(" ")}
              aria-pressed={team === "TEAM_A"}
              onClick={() => setTeam("TEAM_A")}
            >
              Team A
            </button>
            <button
              type="button"
              className={[styles.teamButton, team === "TEAM_B" && styles.teamButtonActive, team === "TEAM_B" && styles.teamB].filter(Boolean).join(" ")}
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
    </div>
  );
}

function PlayerGame({ identity }: { identity: Identity }) {
  const role = identity.role as "TEAM_A" | "TEAM_B";
  const otherTeam = role === "TEAM_A" ? "TEAM_B" : "TEAM_A";
  const rosterVariant: Record<"TEAM_A" | "TEAM_B", "teamA" | "teamB"> = { TEAM_A: "teamA", TEAM_B: "teamB" };
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const account = useAccountStore((state) => state.account);
  const { sendAction, sendChatMessage, sendStroke, sendDrawingClear, sendDrawingUndo, requestDrawingSnapshot, requestDrawingPrompt } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameKey = useGameStore((state) => state.gameKey);
  const rawGameState = useGameStore((state) => state.gameState);
  const gameState = rawGameState as unknown as GenericGameState | null;
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const liveSessionEnded = useGameStore((state) => state.sessionEnded);
  const kicked = useGameStore((state) => state.kicked);
  const synced = useGameStore((state) => state.synced);
  const presence = usePresenceStore((state) => state.participants);
  const hostConnected = presence.some((p) => p.role === "HOST");

  const sessionState = trpc.session.getState.useQuery(
    { sessionCode: identity.sessionCode },
    { refetchInterval: 2000, retry: false },
  );
  const roster = sessionState.data;

  // See host/page.tsx's identical comment.
  const sessionEnded = liveSessionEnded || sessionState.error?.data?.sessionErrorCode === "SESSION_NOT_FOUND";
  const phase = deriveSessionPhase({ sessionStatus: sessionState.data?.status, gameId, gameStatus: readGameStatus(rawGameState), sessionEnded });
  const [forgetOpen, setForgetOpen] = useState(false);

  // The READY->3->2->1->LIVE moment (GameStartingSequence), on THIS
  // client's own terms — unlike host/page.tsx, a player never clicks
  // Start, they only ever find out a game began by `phase` itself
  // changing underneath them (the `game:state` broadcast landing). Same
  // render-phase "adjust local state to match a changed prop" pattern
  // DisplayGeoPanel's useRevealStage already uses: `prevPhase` starts
  // equal to the CURRENT phase (so a reconnect/refresh mid-game never
  // fires this — there was no transition, just a first render already
  // in GAME_IN_PROGRESS), and only a genuine SESSION_LOBBY/GAME_FINISHED
  // -> GAME_IN_PROGRESS transition, witnessed live while mounted, sets
  // it. GameStartingSequence always plays its own fixed ~1.8s local
  // timeline regardless of when `live` actually flips true (see that
  // component's doc comment), so this reads the exact same countdown
  // the host already sees, not a shortened one.
  const { sequenceActive, setSequenceActive } = useGameStartingSequence(phase, synced);

  // Real, reported feedback: an always-open chat — even one with
  // genuinely nothing more important competing with it (the Lobby) —
  // still reads as "surchargé" when `GameChatPanel`'s own box commits a
  // fixed ~22rem of height (`GameChatPanel.module.css`, shared with
  // Host/Display, not changed) to what's usually an empty "No messages
  // yet." A collapsed `<details>` everywhere (not just during
  // GAME_IN_PROGRESS, this pass's own earlier fix) removes that
  // permanent block of empty space — but collapsing it can't mean
  // hiding the fact that something actually arrived, so the summary
  // itself carries a real unread count, summed across every channel
  // this role can actually see (same `unreadByChannel`/`channelsForRole`
  // GameChatPanel's own tabs already use — not a second source of truth).
  const unreadByChannel = useChatStore((state) => state.unreadByChannel);
  const totalUnread = channelsForRole(role).reduce((sum, channel) => sum + (unreadByChannel[channel] ?? 0), 0);

  const matchScore = roster?.matchScore;

  // ONE row, not two — a real, measured audit finding (see todos.md):
  // the previous separate `topBar` + `identityBar` rows cost ~50-60px of
  // pure chrome above the fold before any game content, on a screen
  // whose whole point is "the map should dominate." Brand/code/identity/
  // show-score/menu all carry real but genuinely low-priority
  // information during actual gameplay — worth a glance, never worth a
  // whole row each.
  const topBar = (
    <>
      <div className={styles.topBar}>
        <div className={styles.brandCluster}>
          <Link href="/" className={`${styles.brandMark} vb-wordmark-transition`}>
            VB
          </Link>
          <span className={styles.sessionCode}>#{identity.sessionCode}</span>
          <span className={[styles.identityChip, styles[rosterVariant[role]]].join(" ")}>{identity.displayName}</span>
        </div>
        <div className={styles.topBarEnd}>
          {/* Silent on a healthy connection (same "quiet chrome" posture
              as the account link/menu button right next to it) — a real,
              audited gap: `status` used to be read from gameStore but
              never actually rendered anywhere on this screen, so a
              reconnecting/dead socket was invisible while the Buzz button
              stayed lit and tappable. Reuses ConnectionBadge as-is (the
              same component Host already shows unconditionally) rather
              than a second connection-status system. */}
          {status !== "connected" && <ConnectionBadge status={status} />}
          {matchScore && matchScore.TEAM_A + matchScore.TEAM_B > 0 && (
            <span className={styles.showScoreLabel}>
              MATCH <strong>{matchScore.TEAM_A}–{matchScore.TEAM_B}</strong>
            </span>
          )}
          {/* Only when actually signed into a real account (accountStore.ts)
              — a plain "compte provisoire" seat (just a typed display
              name, no login) has nothing to reach here, same as this
              header shows no Show-score badge when there's no Show in
              progress. Same icon-button footprint as the "⋯" menu right
              next to it, not a full text link competing for the same
              compact row this whole header was measured/trimmed for
              (Round 14) — a real account's stats/settings are one tap
              away without leaving the live game (identityStore.ts's own
              per-tab game identity is untouched by navigating there and
              back). */}
          {account && (
            <Link href="/account" className={styles.menuButton} aria-label={`Account — signed in as ${account.username}`} title={`Signed in as ${account.username}`}>
              👤
            </Link>
          )}
          {/* Local-only, same as Host's "Forget this session" — leaves this
              browser's seat as-is server-side (still occupied, still
              reconnectable with the original token), just stops showing it
              here. For "wrong game, let me join a different one" without
              needing to clear cookies/storage by hand. Confirmed, not
              instant — a stray tap mid-buzz shouldn't be able to boot you
              out of the game you're actively playing. Tucked into a small
              icon button now, not a full ghost button competing with the
              rest of the header for attention. */}
          <button type="button" className={styles.menuButton} onClick={() => setForgetOpen(true)} aria-label="Not your game? Leave this session">
            ⋯
          </button>
        </div>
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
    </>
  );

  // Checked before `phase` even matters — being kicked is a fact about
  // THIS participant's own seat, independent of whatever the session
  // itself is doing right now (still very much alive for everyone else,
  // `session.getState` keeps resolving normally — only this tab's token
  // is dead). See KickedNotice's own doc comment on why this isn't just
  // SessionEndedNotice with different copy.
  if (kicked) {
    return (
      <div className={styles.shell}>
        {topBar}
        <div className={styles.centerBody}>
          <KickedNotice onRejoin={clearIdentity} />
        </div>
      </div>
    );
  }

  if (phase === "SESSION_FINISHED") {
    return (
      <div className={styles.shell}>
        {topBar}
        <div className={styles.centerBody}>
          <SessionEndedNotice sessionCode={identity.sessionCode} />
          <div className={styles.startRow}>
            <Button variant="ghost" onClick={clearIdentity}>
              Join a different game
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // A REAL, REPORTED gap this closes ("tu as juste enlevé le loader"):
  // `useGameStartingSequence`'s own fix for the reload-replays-the-intro
  // bug means `synced` (gameStore.ts) is false for a real, if brief,
  // window on every mount/reload before the game's true state is known —
  // and without this guard, that gap fell through to the phase-driven
  // tree below computed off placeholder data (`gameId`/`gameState` both
  // still null), flashing the WRONG screen (an empty "waiting for the
  // game to start" Lobby, even mid-game) before snapping to the real
  // board the instant the catch-up snapshot landed. This is the
  // replacement: a genuine "still syncing" beat instead of either the
  // old, wrong replayed countdown OR nothing/wrong-content at all.
  if (!synced) {
    return (
      <div className={styles.shell}>
        {topBar}
        <div className={styles.centerBody}>
          <div className={styles.centerStatus}>
            <span className={styles.centerStatusPulse} aria-hidden="true" />
            <p className={styles.centerStatusLabel}>Connecting</p>
            <p className={styles.centerStatusHeadline}>Syncing your game…</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {topBar}

      {!hostConnected && <HostDisconnectedBanner />}

      {/* THIS tab's own socket, not the host's — the case the audit
          flagged as most dangerous: a player mid-buzz whose connection
          just dropped had zero indication that the Buzz button below was
          no longer really live. `disconnected` is socket.io's own
          reconnect loop (self-healing); `unauthorized` is a genuine dead
          end (a rejected/expired token) that, unlike `disconnected`,
          never gets a second chance to arrive as `session:ended`/
          `participant:kicked` — those are events THIS SAME dead socket
          can no longer deliver, so this banner is the only signal at all
          for that case. */}
      {status === "disconnected" && (
        <StatusBanner title="RECONNECTING…" subtitle="Your connection dropped — actions may not go through until it's back." />
      )}
      {status === "unauthorized" && (
        <StatusBanner tone="danger" title="CONNECTION LOST" subtitle="This session is no longer valid on this device — rejoin to keep playing." />
      )}

      {sequenceActive ? (
        <div className={styles.startingWrap}>
          <GameStartingSequence live={phase === "GAME_IN_PROGRESS"} onDone={() => setSequenceActive(false)} size="large" />
        </div>
      ) : (
        /* `key={phase}` remounts this wrapper whenever the real derived
            phase changes, replaying the fade-in — a CSS side-effect of a
            real state transition, never itself a decision about what to
            show (see AGENTS.md "Session vs. Game phases").
            `.centerBody` applies here regardless of phase — including live
            GAME_IN_PROGRESS panels, not just the short Lobby/status
            screens `.centerBody`'s own doc comment focuses on. Safe for a
            TALL panel (GeoGuessr's map, Drawing's canvas, an opened chat
            drawer) precisely because of how CSS flexbox centering
            actually degrades: `justify-content: center` only redistributes
            LEFTOVER space once a flex item's content already fills its
            container — a flex item taller than what's left just grows
            past its "fair share" (normal document flow, page scrolls), it
            never gets center-clipped with its own top hidden above the
            fold. So a short buzzer panel (most of this session's own
            recently-built games) gets the same real "not stuck at the top
            of a big screen" fix the Lobby did, and a tall one simply
            behaves exactly as it already did before this. */
        <div key={phase} className={[styles.phaseIn, styles.centerBody].join(" ")}>
          {(phase === "SESSION_LOBBY" || phase === "GAME_FINISHED") && (
            <>
              {/* Real, reported gap: the "GAME OVER — Team X wins" splash
                  (WinnerReveal) only ever played for the Host and the Display
                  — a player finishing a game saw nothing but a plain "waiting
                  for the next game" card, the exact same moment their own
                  team either just won or lost rendered invisible to them.
                  Same component, same choreography, mounted the identical way
                  (this whole block already remounts fresh via the wrapping
                  `key={phase}` above whenever GAME_IN_PROGRESS -> GAME_FINISHED
                  really happens) — a player gets the identical "GAME OVER"
                  reveal at the identical moment the Host/Display do, direct
                  from the same broadcast `game:state`, never a local guess. */}
              {phase === "GAME_FINISHED" && gameState && (
                <>
                  <WinnerReveal winner={gameState.winner ?? "TIE"} teamAScore={gameState.scores.TEAM_A} teamBScore={gameState.scores.TEAM_B} viewerTeam={role} />
                  {/* Real, findable practicality — the exact moment this
                      account's own stats (getUserStats, src/server/db/
                      user.ts) just changed is precisely the moment a
                      viewer is most likely to want to go check them,
                      not some other, unrelated point in the app. Absent
                      entirely for a plain "compte provisoire" seat, same
                      conditional-chrome discipline as the topBar's own
                      account icon. */}
                  {account && (
                    <Link href="/account" className={styles.accountStatsLink}>
                      See your updated stats →
                    </Link>
                  )}
                </>
              )}

              {/* One headline status, not a small pill card — "où en
                  suis-je / qu'est-ce que j'attends" answered at a glance.
                  A real, derived fact (`hostConnected`, the same live
                  presence signal every screen already reads), not new
                  state — see LobbyStatus.tsx's own doc comment on why
                  these are the only real values here. */}
              <div className={styles.centerStatus}>
                <span className={[styles.centerStatusPulse, hostConnected && styles.ready].filter(Boolean).join(" ")} aria-hidden="true" />
                <p className={styles.centerStatusLabel}>{hostConnected ? "Ready" : "Waiting for host"}</p>
                <p className={styles.centerStatusHeadline}>
                  {phase === "GAME_FINISHED" ? "Waiting for the next game" : "Waiting for the game to start"}
                </p>
              </div>

              {roster && (
                <div className={styles.rosterRow}>
                  <TeamRoster
                    teamName={role === "TEAM_A" ? "Your team — Team A" : "Your team — Team B"}
                    variant={rosterVariant[role]}
                    seats={toRosterSeats(role === "TEAM_A" ? roster.teamA : roster.teamB, presence, role)}
                    highlightId={presence.find((p) => p.role === role && p.displayName === identity.displayName)?.participantId}
                  />
                  <TeamRoster
                    teamName={otherTeam === "TEAM_A" ? "Opponents — Team A" : "Opponents — Team B"}
                    variant={rosterVariant[otherTeam]}
                    seats={toRosterSeats(otherTeam === "TEAM_A" ? roster.teamA : roster.teamB, presence, otherTeam)}
                  />
                </div>
              )}

              <ChatDrawer role={role} displayName={identity.displayName} participantId={identity.participantId} sendChatMessage={sendChatMessage} unread={totalUnread} />
            </>
          )}

          {phase === "GAME_IN_PROGRESS" && gameState && (
            <>
              {gameKey === "geoguessr" ? (
                <PlayerGeoPanel state={rawGameState as unknown as GeoGuessrState} role={role} displayName={identity.displayName} sendAction={sendAction} />
              ) : gameKey === "drawing" ? (
                <PlayerDrawingPanel
                  state={rawGameState as unknown as DrawingState}
                  role={role}
                  displayName={identity.displayName}
                  sendAction={sendAction}
                  sendStroke={sendStroke}
                  sendDrawingClear={sendDrawingClear}
                  sendDrawingUndo={sendDrawingUndo}
                  requestDrawingSnapshot={requestDrawingSnapshot}
                  requestDrawingPrompt={requestDrawingPrompt}
                />
              ) : gameKey === "music" ? (
                <PlayerMusicPanel state={rawGameState as unknown as MusicState} role={role} lastEvents={lastEvents} sendAction={sendAction} />
              ) : gameKey === "steamRatings" ? (
                <PlayerSteamPanel state={rawGameState as unknown as SteamRatingsState} role={role} lastEvents={lastEvents} sendAction={sendAction} />
              ) : gameKey === "guessThePrice" ? (
                <PlayerPricePanel state={rawGameState as unknown as GuessThePriceState} role={role} lastEvents={lastEvents} sendAction={sendAction} />
              ) : gameKey === "pointingSystem" ? (
                <PlayerPointingPanel state={rawGameState as unknown as PointingSystemState} />
              ) : (
                <PlayerBoardPanel state={rawGameState as unknown as BoardQuestionState} role={role} lastEvents={lastEvents} sendAction={sendAction} />
              )}
              <ChatDrawer role={role} displayName={identity.displayName} participantId={identity.participantId} sendChatMessage={sendChatMessage} unread={totalUnread} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Chat, everywhere in the Player screen — collapsed by default, always.
 * `GameChatPanel`'s own box commits a fixed ~22rem of height
 * (`GameChatPanel.module.css`, shared with Host/Display — untouched)
 * regardless of content, which read as real "surcharge" even in the
 * Lobby where nothing else was competing with it: a huge empty "No
 * messages yet" box is still visual weight, not information. A plain
 * `<details>` (no extra state, no extra JS, accessible by default)
 * removes that permanent block of space, and the summary itself carries
 * a real unread count (`unread`, summed across every channel this role
 * can see — PlayerGame's own top comment) so collapsing it can never
 * mean silently missing a message; the socket keeps writing into
 * `chatStore` regardless of whether this is open.
 */
function ChatDrawer({
  role,
  displayName,
  participantId,
  sendChatMessage,
  unread,
}: {
  role: "TEAM_A" | "TEAM_B";
  displayName: string;
  participantId: string;
  sendChatMessage: (channel: ChatChannel, body: string) => void;
  unread: number;
}) {
  return (
    <details className={styles.chatDrawer}>
      <summary>
        <span className={styles.chatDrawerLabel}>
          Chat
          {unread > 0 && (
            <span className={styles.chatUnreadBubble} aria-label={`${unread} unread message${unread === 1 ? "" : "s"}`}>
              {unread}
            </span>
          )}
        </span>
        <span className={styles.chatDrawerChevron} aria-hidden="true">
          ▾
        </span>
      </summary>
      <GameChatPanel role={role} displayName={displayName} participantId={participantId} sendChatMessage={sendChatMessage} />
    </details>
  );
}
