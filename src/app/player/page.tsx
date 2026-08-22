"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Button, ConfirmDialog, Input, TeamRoster } from "@/ui";
import { PlayerBoardPanel } from "@/app/_shared/boardQuestion/PlayerBoardPanel";
import { WinnerReveal } from "@/app/_shared/boardQuestion/WinnerReveal";
import { PlayerGeoPanel } from "@/app/_shared/geoGuessr/PlayerGeoPanel";
import { GameChatPanel } from "@/app/_shared/GameChatPanel";
import { useChatStore } from "@/app/_shared/chatStore";
import { channelsForRole, type ChatChannel } from "@/domain/chat";
import { GameStartingSequence } from "@/app/_shared/GameStartingSequence";
import { HostDisconnectedBanner } from "@/app/_shared/HostDisconnectedBanner";
import { SessionEndedNotice } from "@/app/_shared/SessionEndedNotice";
import { KickedNotice } from "@/app/_shared/KickedNotice";
import { useGameStore } from "@/app/_shared/gameStore";
import { useGameSocket } from "@/app/_shared/useGameSocket";
import { usePresenceStore } from "@/app/_shared/presenceStore";
import { toRosterSeats } from "@/app/_shared/roster";
import { deriveSessionPhase, readGameStatus } from "@/app/_shared/sessionPhase";
import { useIdentityStore, type Identity } from "@/app/_shared/identityStore";
import { getLastDisplayName, saveLastDisplayName, clearLastDisplayName } from "@/app/_shared/lastDisplayName";
import { RememberedNameHint } from "@/app/_shared/RememberedNameHint";
import { useAccountStore } from "@/app/_shared/accountStore";
import { AccountBadge } from "@/app/_shared/AccountBadge";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import type { Scoreboard } from "@/domain/game";
import type { TeamRole } from "@/domain/session";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";

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

  // Real, reported friction: finishing a game and joining a fresh one
  // (or just coming back another day) meant retyping the exact same
  // name every single time. `useEffect`, not a `useState` initializer —
  // `localStorage` isn't available during SSR, and reading it in the
  // initializer would make the server-rendered markup (always empty)
  // disagree with the client's first real render, a hydration mismatch
  // (same class of bug this app's own `useReducedMotionSafe` exists to
  // avoid). Only overwrites the field if it's still genuinely empty —
  // never clobbers something the player already started typing before
  // this effect's own microtask got a chance to run.
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
    const stored = getLastDisplayName("player");
    // A genuine one-time read of an external system (localStorage) on
    // mount — not a subscription with an ongoing value to track, so
    // there's no render-phase equivalent (PageChangeCurtain.tsx's own
    // comment on that pattern) to reach for instead here.
    if (stored) {
      setRemembered(stored);
      setDisplayName((current) => current || stored);
    }
  }, [account]);

  function logOutRememberedName() {
    clearLastDisplayName("player");
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
      saveLastDisplayName("player", name);
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
  const { sendAction, sendChatMessage } = useGameSocket(identity.token);
  const gameId = useGameStore((state) => state.gameId);
  const gameKey = useGameStore((state) => state.gameKey);
  const rawGameState = useGameStore((state) => state.gameState);
  const gameState = rawGameState as unknown as GenericGameState | null;
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const liveSessionEnded = useGameStore((state) => state.sessionEnded);
  const kicked = useGameStore((state) => state.kicked);
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
  const [prevPhase, setPrevPhase] = useState(phase);
  const [sequenceActive, setSequenceActive] = useState(false);
  if (prevPhase !== phase) {
    if (phase === "GAME_IN_PROGRESS" && prevPhase !== "GAME_IN_PROGRESS") setSequenceActive(true);
    setPrevPhase(phase);
  }

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
        <KickedNotice onRejoin={clearIdentity} />
      </div>
    );
  }

  if (phase === "SESSION_FINISHED") {
    return (
      <div className={styles.shell}>
        {topBar}
        <SessionEndedNotice sessionCode={identity.sessionCode} />
        <div className={styles.startRow}>
          <Button variant="ghost" onClick={clearIdentity}>
            Join a different game
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      {topBar}

      {!hostConnected && <HostDisconnectedBanner />}

      {sequenceActive ? (
        <div className={styles.startingWrap}>
          <GameStartingSequence live={phase === "GAME_IN_PROGRESS"} onDone={() => setSequenceActive(false)} />
        </div>
      ) : (
        /* `key={phase}` remounts this wrapper whenever the real derived
            phase changes, replaying the fade-in — a CSS side-effect of a
            real state transition, never itself a decision about what to
            show (see AGENTS.md "Session vs. Game phases"). */
        <div key={phase} className={styles.phaseIn}>
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
                  <WinnerReveal winner={gameState.winner ?? "TIE"} teamAScore={gameState.scores.TEAM_A} teamBScore={gameState.scores.TEAM_B} />
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

              <ChatDrawer role={role} displayName={identity.displayName} sendChatMessage={sendChatMessage} unread={totalUnread} />
            </>
          )}

          {phase === "GAME_IN_PROGRESS" && gameState && (
            <>
              {gameKey === "geoguessr" ? (
                <PlayerGeoPanel state={rawGameState as unknown as GeoGuessrState} role={role} displayName={identity.displayName} sendAction={sendAction} />
              ) : (
                <PlayerBoardPanel state={rawGameState as unknown as BoardQuestionState} role={role} lastEvents={lastEvents} sendAction={sendAction} />
              )}
              <ChatDrawer role={role} displayName={identity.displayName} sendChatMessage={sendChatMessage} unread={totalUnread} />
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
  sendChatMessage,
  unread,
}: {
  role: "TEAM_A" | "TEAM_B";
  displayName: string;
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
      <GameChatPanel role={role} displayName={displayName} sendChatMessage={sendChatMessage} />
    </details>
  );
}
