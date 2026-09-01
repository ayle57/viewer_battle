"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { popIn } from "@/app/_shared/motion/variants";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Badge, Button, Card, CardBody, CardHeader, ConfirmDialog, Input, Tabs, TeamRoster, PresenceDot } from "@/ui";
import { HostBoardPanel } from "@/app/_shared/boardQuestion/HostBoardPanel";
import { PreviousGameCard } from "@/app/_shared/boardQuestion/PreviousGameCard";
import { WinnerReveal } from "@/app/_shared/boardQuestion/WinnerReveal";
import { HostGeoPanel } from "@/app/_shared/geoGuessr/HostGeoPanel";
import { HostDrawingPanel } from "@/app/_shared/drawing/HostDrawingPanel";
import { HostMusicPanel } from "@/app/_shared/music/HostMusicPanel";
import { HostSteamPanel } from "@/app/_shared/steamRatings/HostSteamPanel";
import { HostPricePanel } from "@/app/_shared/guessThePrice/HostPricePanel";
import { HostPointingPanel } from "@/app/_shared/pointingSystem/HostPointingPanel";
import { ConnectionBadge } from "@/app/_shared/ConnectionBadge";
import { ContentReadinessNotice } from "@/app/_shared/ContentReadinessNotice";
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
import { useAccountStore, type Account } from "@/app/_shared/accountStore";
import { AccountBadge } from "@/app/_shared/AccountBadge";
import { ActionsMenu } from "@/app/_shared/ActionsMenu";
import { readableSessionError } from "@/app/_shared/sessionErrorMessages";
import { listGameDefinitions, type GameKey, type Scoreboard } from "@/domain/game";
import type { TeamRole } from "@/domain/session";
import { useContentIdentityStore } from "./content/_shared/contentIdentityStore";
import { ReadinessBadge, ReadinessLine } from "./content/_shared/ReadinessBadge";
import { GeoReadinessLine } from "./content/_shared/GeoReadinessBadge";
import { DrawingReadinessLine } from "./content/_shared/DrawingReadinessBadge";
import { MusicReadinessLine } from "./content/_shared/MusicReadinessBadge";
import { SteamReadinessLine } from "./content/_shared/SteamReadinessBadge";
import { PriceReadinessLine } from "./content/_shared/PriceReadinessBadge";
import { issueQueryParam } from "./content/_shared/readinessNav";
import styles from "./page.module.css";
import type { BoardQuestionState } from "@/domain/game/boardQuestion";
import type { GeoGuessrState } from "@/domain/game/geoGuessr";
import type { DrawingState } from "@/domain/game/drawing";
import type { MusicState } from "@/domain/game/music";
import type { SteamRatingsState } from "@/domain/game/steamRatings";
import type { GuessThePriceState } from "@/domain/game/guessThePrice";
import type { PointingSystemState } from "@/domain/game/pointingSystem";

/** Game engines all expose `scores`/`winner` via scoring.ts's shared Scoreboard shape (see PreviousGameCard.tsx's identical narrowing) — enough to drive the header score badges / WinnerReveal / PreviousGameCard generically, without either engine's full state type. Panels that need the FULL state (HostBoardPanel/HostGeoPanel) narrow separately, keyed on the real `gameKey` from the store. */
type GenericGameState = { scores: Scoreboard; winner: TeamRole | "TIE" | null };

/** "Default Mini Jeopardy" is never a DB row — see prisma/schema.prisma's
 * "Content Studio" comment on deliberately not seeding fake content. This
 * sentinel just means "start with the built-in sampleBoard," which is
 * exactly what `game.start` already does when `content` is omitted. */
type ContentSelection = { type: "sample" } | { type: "playlist"; playlistId: string; contentToken: string };

/** The exact same "Default X" name each game's own content picker already shows for its sample content (the `gameCardTitle` label right above each picker's playlist grid) — reused here so the Lobby's sidebar never has to invent a second name for the same thing. Keyed by `GameKey`; an engine with no content model (pointingSystem) simply has no entry, so `currentContentLabel` below stays `undefined` for it — same "no content line at all" behavior it already had. */
const SAMPLE_CONTENT_LABEL: Partial<Record<GameKey, string>> = {
  "board-question": "Default Mini Jeopardy",
  geoguessr: "Default GeoGuessr",
  drawing: "Default Drawing",
  music: "Default Guess the Music",
  steamRatings: "Default Guess the Game",
  guessThePrice: "Default Guess the Price",
};

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
 * Gated behind a real, `isAdmin` account (accountStore.ts) — "il faut se
 * connecter au compte streamer": the whole point of `User.isAdmin`
 * (prisma/schema.prisma) is that reaching this screen at all now means
 * proving you're logged in as the streamer's own account, the same real
 * identity the admin dashboard already trusts, not a shared password
 * typed fresh into a form every time. `CreateGameForm` below passes that
 * SAME account token straight to `session.create` — no separate
 * "Host password" field left to fill in once you're already past this
 * gate (see router.ts's own doc comment: HOST_PASSWORD still works
 * byte-for-byte for the /dev playground, this is purely an additive,
 * stronger alternative for the real product's own /host page).
 *
 * Two tabs, not one form, once past the gate: "New game" (create + join,
 * the common case) and "Reconnect" (session.reclaimHost — recovers the
 * HOST seat with the one-time recovery key instead of the lost bearer
 * token). Host identity only lives in sessionStorage (identityStore.ts),
 * so closing the tab — not just reloading it — genuinely loses it;
 * without this second tab a host in that spot would be permanently
 * locked out of a session that's still live for every other connected
 * participant.
 */
function HostConnexion() {
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const account = useAccountStore((state) => state.account);
  const clearAccount = useAccountStore((state) => state.clearAccount);
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

  if (!account) return <HostAccountGate />;
  // A real, resolved account — just cached as not `isAdmin` at its own
  // last login (see accountStore.ts's own doc comment on why this is a
  // client-side nicety, not the real boundary: session.create itself
  // always re-checks server-side regardless). Never silently shows the
  // Create/Reconnect forms for an account that would just fail anyway.
  if (!account.isAdmin) return <HostNotAdminNotice account={account} />;

  return (
    <div className={styles.connexion}>
      {/* Same pill everywhere on the site that shows "signed in" —
          AccountBadge's own doc comment explains why this replaced a
          plain CardHeader subtitle text here. */}
      <div className={styles.accountRow}>
        <AccountBadge />
      </div>
      <ResumeShowBanner account={account} onResumed={setIdentity} />
      <Card variant="raised">
        <CardHeader title="Host a game" subtitle="ViewerBattle" />
        <CardBody>
          <Tabs
            items={[
              { value: "create", label: "New game", content: <CreateGameForm account={account} onCreated={setPendingReveal} /> },
              { value: "reclaim", label: "Reconnect", content: <ReclaimHostForm account={account} onReclaimed={setIdentity} /> },
            ]}
          />
        </CardBody>
      </Card>
      {/* Content Studio has its own, session-independent auth (a Content
          Studio bearer token, not this session's HOST Participant token —
          see prisma/schema.prisma's "Content Studio" comment) — a Host
          must be able to reach it to prepare a show BEFORE creating any
          game, not only from inside one already running (HostGame's own
          header link below covers that second case). */}
      <p className={styles.connexionFooter}>
        Just preparing? <Link href="/host/content">Go to the Content Studio</Link> — no game needed.
      </p>
      <button type="button" className={styles.switchAccountLink} onClick={() => clearAccount()}>
        Not {account.username}? Log out
      </button>
    </div>
  );
}

/**
 * A REAL, REPORTED UX gap — walking `/host` as an actual streamer
 * surfaced it directly (findActiveHostSessionForAccount's own doc
 * comment, src/server/db/participant.ts, has the full reasoning): the
 * one-time recovery key is redundant friction now that a real,
 * `isAdmin` account already proves who's asking. Renders nothing at
 * all — not even a loading flicker — until it actually finds something
 * to resume; the overwhelmingly common case (no show running yet) shows
 * the ordinary New game / Reconnect card below with zero extra chrome.
 */
function ResumeShowBanner({ account, onResumed }: { account: Account; onResumed: (identity: Identity) => void }) {
  const resume = trpc.session.resumeByAccount.useQuery({ accountToken: account.token });
  const reclaim = trpc.session.reclaimByAccount.useMutation();
  const [error, setError] = useState<string | null>(null);

  if (!resume.data) return null;

  async function handleResume() {
    setError(null);
    try {
      const result = await reclaim.mutateAsync({ accountToken: account.token });
      onResumed({ sessionCode: result.sessionCode, role: "HOST", displayName: result.displayName, token: result.token, participantId: result.id });
    } catch (err) {
      setError(err instanceof TRPCClientError ? err.message : "Couldn't resume — try again.");
    }
  }

  return (
    <Card variant="raised" className={styles.resumeCard}>
      <CardBody>
        <p className={styles.resumeLabel}>You have a show already running</p>
        <p className={styles.resumeCode}>Session {resume.data.sessionCode}</p>
        {error && <p className={styles.errorBanner}>{error}</p>}
        <Button size="lg" fullWidth loading={reclaim.isPending} onClick={() => void handleResume()}>
          Resume show
        </Button>
      </CardBody>
    </Card>
  );
}

/** The login step "il faut se connecter au compte streamer" actually asks for — login only, deliberately no "create an account" toggle the way /account's own AccountAuth has: a fresh, self-registered account could never be `isAdmin` anyway (see User.isAdmin's own doc comment), so offering to register one here would just be a dead end dressed up as a real option. */
function HostAccountGate() {
  const setAccount = useAccountStore((state) => state.setAccount);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = trpc.user.login.useMutation();

  async function handleSubmit() {
    setError(null);
    try {
      const result = await login.mutateAsync({ username, password });
      setAccount({ token: result.token, username: result.username, isAdmin: result.isAdmin });
    } catch (err) {
      setError(err instanceof TRPCClientError ? err.message : "Couldn't sign in — try again.");
    }
  }

  return (
    <div className={styles.connexion}>
      {/* An explicit, unmissable way back — the exact same "← VIEWERBATTLE"
          pattern /account's own page already uses for this identical
          reason (see that file's own doc comment): a real, reported gap —
          whoever lands here without being the streamer (curious visitor,
          a bookmark, a wrong click from the homepage's own "Host a Game"
          button) had NO way out of this screen except the browser's own
          back button. */}
      <Link href="/" className={`${styles.brandMark} ${styles.connexionBackLink} vb-wordmark-transition`}>
        ← VIEWERBATTLE
      </Link>
      <Card variant="raised">
        <CardHeader title="Host a game" subtitle="Log in as the streamer to continue" />
        <CardBody>
          <form
            className={styles.connexionForm}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <Input size="lg" label="Username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. erwin" autoFocus />
            <Input size="lg" type="password" label="Password" value={password} onChange={(event) => setPassword(event.target.value)} />
            {error && <p className={styles.errorBanner}>{error}</p>}
            <Button size="lg" type="submit" loading={login.isPending} disabled={!username.trim() || !password} fullWidth>
              Log in
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}

/** A real, resolved account that just isn't the streamer's — see router.ts's session.create doc comment on why this is possible (any viewer can self-register) and User.isAdmin's own comment on why that's fine (it just never authorizes hosting). */
function HostNotAdminNotice({ account }: { account: Account }) {
  const clearAccount = useAccountStore((state) => state.clearAccount);
  return (
    <div className={styles.connexion}>
      {/* Same "always a way back" fix as HostAccountGate above — a real
          account that just isn't the streamer's is arguably even MORE
          likely to want an exit that isn't "log out of my own account":
          browsing elsewhere on the site while staying signed in. */}
      <Link href="/" className={`${styles.brandMark} ${styles.connexionBackLink} vb-wordmark-transition`}>
        ← VIEWERBATTLE
      </Link>
      <Card variant="raised">
        <CardHeader title="This account can't host" subtitle={`Signed in as ${account.username}`} />
        <CardBody>
          <p className={styles.hint}>Only the streamer&rsquo;s own account can create or reconnect to a show. If this isn&rsquo;t you, log out and sign in as the right account.</p>
          <Button variant="ghost" onClick={() => clearAccount()}>
            Log out
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}

function CreateGameForm({ account, onCreated }: { account: Account; onCreated: (reveal: { hostKey: string; identity: Identity }) => void }) {
  // Defaults to the account's own username — editable, since the display
  // name a Host shows the room isn't necessarily identical to their
  // account username (e.g. a branded "Erwin Live" vs. the plain account
  // "erwin"). No `getLastDisplayName`/`RememberedNameHint` machinery
  // needed here anymore — that convenience existed to guess at a name
  // with no better source of truth; a real, logged-in account (required
  // to even reach this form now — see HostConnexion's own account gate)
  // already IS that better source, same reasoning as PlayerJoin's own
  // account-supersedes-remembered-name effect.
  const [displayName, setDisplayName] = useState(account.username);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const createSession = trpc.session.create.useMutation();
  const joinSession = trpc.session.join.useMutation();

  async function handleCreate() {
    const name = displayName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      // No `hostPassword` — the account gate above already proved this
      // is the operator (resolveAdminUserByToken, checked again
      // server-side regardless of anything this client claims — see
      // router.ts's own doc comment on session.create).
      const session = await createSession.mutateAsync({ accountToken: account.token });
      const host = await joinSession.mutateAsync({ sessionCode: session.code, role: "HOST", displayName: name, accountToken: account.token });
      onCreated({
        hostKey: session.hostKey,
        identity: { sessionCode: session.code, role: "HOST", displayName: host.displayName, token: host.token, participantId: host.id },
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
      {error && <p className={styles.errorBanner}>{error}</p>}
      <Button size="lg" type="submit" loading={creating} disabled={!displayName.trim()} fullWidth>
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
function ReclaimHostForm({ account, onReclaimed }: { account: Account; onReclaimed: (identity: Identity) => void }) {
  const [sessionCode, setSessionCode] = useState("");
  const [hostKey, setHostKey] = useState("");
  // Same reasoning as CreateGameForm's identical field — see its own
  // doc comment on why this no longer needs the localStorage
  // remembered-name convenience now that a real account gates this
  // whole form.
  const [displayName, setDisplayName] = useState(account.username);
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
      onReclaimed({ sessionCode: host.sessionCode, role: "HOST", displayName: host.displayName, token: host.token, participantId: host.id });
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

/**
 * "GAME OVER -> +1 POINT" — two purely COSMETIC beats over facts the
 * results splash already has in full the instant it mounts
 * (`gameState.winner`, `roster.matchScore`, both real broadcasts, never
 * guessed at). Same shape as DisplayGeoPanel's own `useRevealStage`
 * (src/app/_shared/geoGuessr/DisplayGeoPanel.tsx) — a local index
 * advanced by `setTimeout`, gated on `!reduced`, that only decides which
 * of two ALREADY-TRUE things is currently showing. Never a `sendAction`,
 * never anything that could change what actually got counted.
 *
 * Deliberately no "next game" beat — the Host has total freedom over
 * what to play next (no fixed lineup exists anymore, see MatchScore's
 * own doc comment), so there's nothing honest to preview here.
 */
type ResultStage = "winner" | "points";
const RESULT_STAGE_ORDER: ResultStage[] = ["winner", "points"];
const RESULT_STAGE_HOLD_MS: Record<ResultStage, number> = { winner: 900, points: 0 };

function useResultStage(active: boolean, resetKey: string, reduced: boolean): ResultStage {
  const [index, setIndex] = useState(0);
  // Render-phase reset on a genuine new result (a fresh gameId), same
  // pattern DisplayGeoPanel's own reveal stage uses — not an effect+setState.
  const [prevResetKey, setPrevResetKey] = useState(resetKey);
  let effectiveIndex = index;
  if (prevResetKey !== resetKey) {
    setPrevResetKey(resetKey);
    effectiveIndex = 0;
    setIndex(0);
  }

  useEffect(() => {
    if (!active || reduced) return;
    if (effectiveIndex >= RESULT_STAGE_ORDER.length - 1) return;
    const timeout = setTimeout(() => setIndex((i) => i + 1), RESULT_STAGE_HOLD_MS[RESULT_STAGE_ORDER[effectiveIndex]!]);
    return () => clearTimeout(timeout);
  }, [active, reduced, effectiveIndex]);

  if (!active) return "winner";
  return reduced ? "points" : RESULT_STAGE_ORDER[effectiveIndex]!;
}

function HostGame({ identity }: { identity: Identity }) {
  const router = useRouter();
  const { sendAction, sendChatMessage, requestDrawingSnapshot } = useGameSocket(identity.token);
  const clearIdentity = useIdentityStore((state) => state.clearIdentity);
  const setIdentity = useIdentityStore((state) => state.setIdentity);
  const gameId = useGameStore((state) => state.gameId);
  const gameKey = useGameStore((state) => state.gameKey);
  const rawGameState = useGameStore((state) => state.gameState);
  const gameState = rawGameState as unknown as GenericGameState | null;
  const status = useGameStore((state) => state.status);
  const lastEvents = useGameStore((state) => state.lastEvents);
  const liveSessionEnded = useGameStore((state) => state.sessionEnded);
  const presence = usePresenceStore((state) => state.participants);

  const start = trpc.game.start.useMutation();
  const finish = trpc.session.finish.useMutation();
  const kick = trpc.session.kick.useMutation();
  const rotateCode = trpc.session.rotateCode.useMutation();
  const sessionState = trpc.session.getState.useQuery(
    { sessionCode: identity.sessionCode },
    { refetchInterval: 2000, retry: false },
  );

  const roster = sessionState.data;
  // A REAL, REPRODUCED bug this `Math.max` closes: this count, like
  // `toRosterSeats` (roster.ts's own doc comment on the identical root
  // cause), used to come ONLY from the polled `session.getState` — up to
  // ~2s stale. `presence` (real-time, socket-pushed) can genuinely
  // outrun it: a player who just joined is already connected before the
  // next poll tick confirms their seat. Confirmed directly: the header
  // read "6/4 connected" right after a fresh join — MORE people
  // connected than the roster-based denominator claimed existed at all,
  // which reads as a bug/error rather than the "someone dropped their
  // connection" signal this badge exists to give. Anyone genuinely
  // present via a live socket has, BY DEFINITION, a real seat somewhere
  // (the server only lets an authenticated participant hold a socket at
  // all) — the poll just hasn't confirmed WHICH one yet. The
  // denominator can never honestly be smaller than the live count.
  const totalRoster = roster ? Math.max(1 + roster.teamA.length + roster.teamB.length + roster.displayCount, presence.length) : presence.length;

  // `liveSessionEnded` (a real-time socket push, the instant version —
  // see gameStore.ts) is the common case; `sessionStatus === "FINISHED"`
  // (sessionPhase.ts) catches the same fact from a plain poll on its
  // own. SESSION_NOT_FOUND here means this session code was never real
  // to begin with, not "it ended" — ending a session is a soft update
  // now (src/server/db/session.ts's endSession), it doesn't delete the
  // row.
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

  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const resultStage = useResultStage(showResultsSplash, gameId ?? "idle", reduced);

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

  // "Choose your content" (see AGENTS.md-equivalent write-up in
  // prisma/schema.prisma's "Content Studio" comment) — only meaningful
  // for a content-capable game (today, just board-question). The
  // ContentHost token is a SEPARATE identity from this session's own
  // HOST Participant identity (`identity` above) — a Host may be running
  // this show in a browser that never signed into Content Studio at all,
  // which is why this degrades to "Default Mini Jeopardy only" rather
  // than blocking Start Game.
  const contentToken = useContentIdentityStore((s) => s.token);
  const selectedGameDefinition = games.find((g) => g.id === selectedGameKey);
  const playlists = trpc.content.playlist.list.useQuery(
    { token: contentToken ?? "", gameKey: "board-question" },
    { enabled: Boolean(contentToken) && selectedGameKey === "board-question" },
  );
  // GeoGuessr's own content list (contentGeoRouter.ts) — a separate query
  // returning a separate, round-shaped summary (GeoPlaylistSummary), not
  // `playlists` above widened to accept it; see contentGeo.ts's doc
  // comment on why this is a parallel module rather than a gameKey branch
  // inside the Jeopardy one.
  const geoPlaylists = trpc.content.geoPlaylist.list.useQuery(
    { token: contentToken ?? "", gameKey: "geoguessr" },
    { enabled: Boolean(contentToken) && selectedGameKey === "geoguessr" },
  );
  // Drawing's own content list (contentDrawingRouter.ts) — same "separate
  // module, own summary shape" reasoning as GeoGuessr's own query above.
  const drawingPlaylists = trpc.content.drawingPlaylist.list.useQuery(
    { token: contentToken ?? "", gameKey: "drawing" },
    { enabled: Boolean(contentToken) && selectedGameKey === "drawing" },
  );
  // Music's own content list (contentMusicRouter.ts) — same "separate
  // module, own summary shape" reasoning as GeoGuessr's/Drawing's own
  // queries above.
  const musicPlaylists = trpc.content.musicPlaylist.list.useQuery(
    { token: contentToken ?? "", gameKey: "music" },
    { enabled: Boolean(contentToken) && selectedGameKey === "music" },
  );
  // Steam Ratings' own content list (contentSteamRouter.ts) — same
  // "separate module, own summary shape" reasoning as GeoGuessr's/
  // Drawing's/Music's own queries above.
  const steamPlaylists = trpc.content.steamPlaylist.list.useQuery(
    { token: contentToken ?? "", gameKey: "steamRatings" },
    { enabled: Boolean(contentToken) && selectedGameKey === "steamRatings" },
  );
  // Guess the Price's own content list (contentPriceRouter.ts) — same
  // "separate module, own summary shape" reasoning as GeoGuessr's/
  // Drawing's/Music's/Steam Ratings' own queries above.
  const pricePlaylists = trpc.content.pricePlaylist.list.useQuery(
    { token: contentToken ?? "", gameKey: "guessThePrice" },
    { enabled: Boolean(contentToken) && selectedGameKey === "guessThePrice" },
  );
  const [contentSelection, setContentSelection] = useState<ContentSelection>({ type: "sample" });
  // The built-in sample content (boardQuestion/fixtures.ts's sampleBoard,
  // geoGuessr/fixtures.ts's sampleGeoPlaylist) has no Playlist row and no
  // readiness concept — it's fixture data, complete by construction. Only
  // a real selected Playlist has a readiness to validate before Start
  // (product brief "Show Preparation" section 3).
  const selectedPlaylist =
    contentSelection.type === "playlist" ? playlists.data?.find((p) => p.id === contentSelection.playlistId) : undefined;
  const selectedGeoPlaylist =
    contentSelection.type === "playlist" ? geoPlaylists.data?.find((p) => p.id === contentSelection.playlistId) : undefined;
  const selectedDrawingPlaylist =
    contentSelection.type === "playlist" ? drawingPlaylists.data?.find((p) => p.id === contentSelection.playlistId) : undefined;
  const selectedMusicPlaylist =
    contentSelection.type === "playlist" ? musicPlaylists.data?.find((p) => p.id === contentSelection.playlistId) : undefined;
  const selectedSteamPlaylist =
    contentSelection.type === "playlist" ? steamPlaylists.data?.find((p) => p.id === contentSelection.playlistId) : undefined;
  const selectedPricePlaylist =
    contentSelection.type === "playlist" ? pricePlaylists.data?.find((p) => p.id === contentSelection.playlistId) : undefined;
  // "Current game" (the sidebar shown once GAME_IN_PROGRESS, below) used
  // to only ever show a `Content: …` line when a real PLAYLIST was
  // selected — picking the sample content (the common case, and the
  // literal default) left the Host with no confirmation of what was
  // actually running at all. One computed label covers both: whichever
  // playlist is selected for the ACTUAL running game's `gameKey`, or the
  // matching `SAMPLE_CONTENT_LABEL` above when sample content was used
  // instead. `undefined` for a game with no content model at all
  // (pointingSystem) — same "no line" behavior as before.
  const currentContentLabel: string | undefined =
    gameKey === "board-question"
      ? (selectedPlaylist?.name ?? SAMPLE_CONTENT_LABEL[gameKey])
      : gameKey === "geoguessr"
        ? (selectedGeoPlaylist?.name ?? SAMPLE_CONTENT_LABEL[gameKey])
        : gameKey === "drawing"
          ? (selectedDrawingPlaylist?.name ?? SAMPLE_CONTENT_LABEL[gameKey])
          : gameKey === "music"
            ? (selectedMusicPlaylist?.name ?? SAMPLE_CONTENT_LABEL[gameKey])
            : gameKey === "steamRatings"
              ? (selectedSteamPlaylist?.name ?? SAMPLE_CONTENT_LABEL[gameKey])
              : gameKey === "guessThePrice"
                ? (selectedPricePlaylist?.name ?? SAMPLE_CONTENT_LABEL[gameKey])
                : undefined;
  const noPlaylistsYet = Boolean(contentToken) && selectedGameKey === "board-question" && playlists.data?.length === 0;
  const noGeoPlaylistsYet = Boolean(contentToken) && selectedGameKey === "geoguessr" && geoPlaylists.data?.length === 0;
  const noDrawingPlaylistsYet = Boolean(contentToken) && selectedGameKey === "drawing" && drawingPlaylists.data?.length === 0;
  const noMusicPlaylistsYet = Boolean(contentToken) && selectedGameKey === "music" && musicPlaylists.data?.length === 0;
  const noSteamPlaylistsYet = Boolean(contentToken) && selectedGameKey === "steamRatings" && steamPlaylists.data?.length === 0;
  const noPricePlaylistsYet = Boolean(contentToken) && selectedGameKey === "guessThePrice" && pricePlaylists.data?.length === 0;
  // Selecting an incomplete board/playlist and clicking Start is never a
  // silent no-op — the backend genuinely refuses it now (see router.ts's
  // game.start, PLAYLIST_NOT_READY). Blocking the button here is the same
  // fact shown a beat earlier, so the Host resolves it (Review board / Use
  // sample content) instead of clicking Start and watching it bounce
  // (product brief "Show Preparation" section 10).
  const startBlocked = Boolean(
    (selectedPlaylist && !selectedPlaylist.readiness.ready) ||
      (selectedGeoPlaylist && !selectedGeoPlaylist.readiness.ready) ||
      (selectedDrawingPlaylist && !selectedDrawingPlaylist.readiness.ready) ||
      (selectedMusicPlaylist && !selectedMusicPlaylist.readiness.ready) ||
      (selectedSteamPlaylist && !selectedSteamPlaylist.readiness.ready) ||
      (selectedPricePlaylist && !selectedPricePlaylist.readiness.ready),
  );

  // Stale-selection cleanup (product brief "Show Preparation" section 11):
  // a playlist picked earlier can be deleted from another tab (e.g. the
  // Content Studio open alongside this one) while this page stays open.
  // Once the list refetches (mount, window focus — React Query's default)
  // and the selected id is genuinely gone, fall back to the sample content
  // instead of leaving a phantom selection pointing at nothing. Render-
  // phase reset (React's blessed "adjusting state when a prop changes"
  // pattern — same shape as PlaylistEditorPage's syncedPlaylistId and
  // BoardEditor's CategoryNameField), not an effect+setState — no
  // localStorage involved either, this is a plain derived reset off the
  // live query result, not a second source of truth. Checks whichever
  // list is actually active for the currently selected game — a stale
  // Jeopardy playlist id must not be "cleaned up" by GeoGuessr's list
  // still loading (and vice versa).
  const activeList =
    selectedGameKey === "geoguessr"
      ? geoPlaylists.data
      : selectedGameKey === "drawing"
        ? drawingPlaylists.data
        : selectedGameKey === "music"
          ? musicPlaylists.data
          : selectedGameKey === "steamRatings"
            ? steamPlaylists.data
            : selectedGameKey === "guessThePrice"
              ? pricePlaylists.data
              : playlists.data;
  if (contentSelection.type === "playlist" && activeList && !activeList.some((p) => p.id === contentSelection.playlistId)) {
    setContentSelection({ type: "sample" });
  }

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

  // "Disconnect this player" — a real ConfirmDialog (same posture as
  // "End session" below): kicking someone is irreversible from THEIR
  // side — the session's join code rotates in the same call (see
  // session.kick, router.ts), so they can't just rejoin under a
  // different name a second later — see KickedNotice. `kickTarget`
  // doubles as both the dialog's open/closed state and which seat it's
  // about, instead of a separate boolean synced by hand.
  const [kickTarget, setKickTarget] = useState<{ id: string; displayName: string } | null>(null);

  function handleKick() {
    if (!kickTarget) return;
    kick.mutate(
      { token: identity.token, participantId: kickTarget.id },
      {
        onSuccess: (result) => setIdentity({ ...identity, sessionCode: result.newSessionCode }),
        onSettled: () => setKickTarget(null),
      },
    );
  }

  // Self-service version of the same rotation `kick` does automatically
  // — "I think this leaked" without needing to kick anyone. A real,
  // confirmed action (same posture as End session): the OLD code stops
  // working for new joins the instant this succeeds, so any invite
  // link/message already sent out goes stale.
  const [rotateCodeOpen, setRotateCodeOpen] = useState(false);

  function handleRotateCode() {
    rotateCode.mutate(
      { token: identity.token },
      {
        onSuccess: (result) => setIdentity({ ...identity, sessionCode: result.newSessionCode }),
        onSettled: () => setRotateCodeOpen(false),
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
    start.mutate({
      token: identity.token,
      // `GameKey` (registry.ts) is deliberately widened to `string` — the
      // registry can't know every engine's shape statically — so this
      // still narrows with one explicit cast to whatever the tRPC schema
      // (gameKeySchema, domain/game/registry.ts) currently accepts; kept
      // in sync with `gameEngines` by construction since that schema is
      // now DERIVED from the registry, not hand-listed.
      gameKey: selectedGameKey as "board-question" | "geoguessr",
      content: contentSelection.type === "playlist" ? contentSelection : undefined,
    });
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
          {/* No inline "New code" button here any more — that's a rare,
              administrative action now folded into the "···" menu below
              (a REAL, reported UX complaint: "imagine être un streamer...
              trop surchargé" — this header alone used to carry SIX
              secondary action buttons at equal visual weight: Copy, New
              code, Content Studio, Admin, Forget this session, End
              session). Copy stays inline — it's the one thing a streamer
              genuinely reaches for constantly, mid-show, to paste the
              code into chat/overlay. */}
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
              above — "···" (rare/administrative — Content Studio, Admin,
              New code, Forget this session) plus the one action that
              genuinely deserves to stay always visible and unmistakably
              colored: "End session" — irreversible, and affects
              everyone else watching, unlike anything folded into the
              menu. Real, reported complaint this closes: this row used
              to carry SIX secondary buttons at equal weight, the same
              "ne mets pas 15 boutons visibles" problem Content Studio's
              own card menus (ActionsMenu, src/app/_shared/) already
              solved once — reused here rather than a second, drifting
              copy of the same fix. */}
          <div className={styles.headerActions}>
            <ActionsMenu
              label="More session actions"
              items={[
                { label: "Content Studio", onSelect: () => router.push("/host/content") },
                // Same gate as Content Studio itself (ContentHost token,
                // checked server-side by adminRouter.ts) — a shortcut
                // straight from the Control Room, not buried one extra
                // click inside Content Studio's own breadcrumb, since
                // this is exactly where the operator spends most of a
                // live show.
                { label: "Admin", onSelect: () => router.push("/host/content/admin") },
                { label: "🔄 New code", onSelect: () => setRotateCodeOpen(true) },
                // Local-only — clears THIS browser's identity, never
                // touches the session server-side. For "I'm testing and
                // want a completely new show" without kicking the
                // players/display still connected to the old one, which
                // "End session" would. The old session (and its roster)
                // stays exactly as it was — the saved recovery key gets
                // back into it via the Reconnect tab on this same page.
                { label: "Forget this session", onSelect: () => setForgetOpen(true) },
              ]}
            />
            {/* Deletes the session for real (src/server/db/session.ts's
                endSession) — every player and the display still watching
                get kicked to "Session ended" in real time, and the
                session code stops working for anyone. Genuinely
                irreversible, hence danger + its own confirmation, and
                deliberately NOT folded into the menu above — this is the
                one action that should stay impossible to miss. */}
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

      <ConfirmDialog
        open={kickTarget !== null}
        title={kickTarget ? `Disconnect ${kickTarget.displayName}?` : undefined}
        description="They're removed from this session immediately, and the session code changes too — they can't just rejoin with the old one. Share the new code yourself if you want them back."
        confirmLabel="Disconnect"
        danger
        confirming={kick.isPending}
        onCancel={() => setKickTarget(null)}
        onConfirm={handleKick}
      />

      <ConfirmDialog
        open={rotateCodeOpen}
        title="Generate a new session code?"
        description="The current code stops working for new joins right away. Everyone already connected keeps playing — this only affects who can join from here on."
        confirmLabel="New code"
        confirming={rotateCode.isPending}
        onCancel={() => setRotateCodeOpen(false)}
        onConfirm={handleRotateCode}
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
            {/* Beat 1, always present from the first render — "GAME OVER"
                (item 4). Beats 2/3 below only ever ADD to the screen as
                `resultStage` advances, never replace or contradict this
                one. */}
            <WinnerReveal winner={gameState.winner ?? "TIE"} teamAScore={gameState.scores.TEAM_A} teamBScore={gameState.scores.TEAM_B} />

            {/* Beat 2 — "+1 POINT", the SAME flat, per-win tally
                `roster.matchScore` always was (MatchScore's own doc
                comment) — every finished game counts, this one
                included, no exceptions and nothing to distinguish a
                "replay" from any other game. */}
            {resultStage !== "winner" && roster && (
              <motion.div className={styles.resultShowPoints} initial="hidden" animate="show" variants={popIn(reduced)}>
                {gameState.winner === "TIE" ? (
                  <Badge variant="neutral">Tied — no point awarded</Badge>
                ) : (
                  <>
                    <p className={styles.resultShowPointsValue}>+1 POINT</p>
                    <MatchScore teamA={roster.matchScore.TEAM_A} teamB={roster.matchScore.TEAM_B} />
                  </>
                )}
              </motion.div>
            )}

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
          {phase === "GAME_FINISHED" && gameState && (
            <PreviousGameCard gameLabel={games.find((g) => g.id === gameKey)?.label ?? "Game"} state={gameState} />
          )}

          <Card>
            <CardHeader title="Lobby" subtitle="Start whenever you're ready — teams don't need to be full." />
            <CardBody>
              {roster && (
                <div className={styles.rosterGrid}>
                  <div>
                    <p className={styles.hint}>Host</p>
                    <PresenceDot connected={presence.some((p) => p.role === "HOST")} />
                  </div>
                  <TeamRoster
                    teamName="Team A"
                    variant="teamA"
                    seats={toRosterSeats(roster.teamA, presence, "TEAM_A")}
                    onKick={(id, displayName) => setKickTarget({ id, displayName })}
                    kickingId={kick.isPending ? kickTarget?.id : null}
                  />
                  <TeamRoster
                    teamName="Team B"
                    variant="teamB"
                    seats={toRosterSeats(roster.teamB, presence, "TEAM_B")}
                    onKick={(id, displayName) => setKickTarget({ id, displayName })}
                    kickingId={kick.isPending ? kickTarget?.id : null}
                  />
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

              {selectedGameDefinition?.hasContentStudio && selectedGameKey === "board-question" && (
                <div className={styles.gameSelection} role="radiogroup" aria-label="Choose your content">
                  <p className={styles.gameSelectionLabel}>Choose your content</p>
                  <div className={styles.gameCardGrid}>
                    <label className={[styles.gameCard, contentSelection.type === "sample" && styles.gameCardSelected].filter(Boolean).join(" ")}>
                      <input
                        type="radio"
                        name="contentSelection"
                        checked={contentSelection.type === "sample"}
                        onChange={() => setContentSelection({ type: "sample" })}
                        className={styles.gameCardRadio}
                      />
                      {contentSelection.type === "sample" && <span className={styles.gameCardChip}>SELECTED</span>}
                      <p className={styles.gameCardTitle}>Default Mini Jeopardy</p>
                      <p className={styles.contentCardMeta}>Sample content</p>
                      <div className={styles.contentCardReadiness}>
                        {/* Fixture data, complete by construction — no
                            Playlist row, no real `getPlaylistReadiness`
                            call needed for something that can never be
                            anything but ready (see the `ContentSelection`
                            type's own comment above). */}
                        <Badge variant="success" dot size="sm">
                          Ready
                        </Badge>
                      </div>
                    </label>
                    {playlists.data?.map((playlist) => {
                      const selected = contentSelection.type === "playlist" && contentSelection.playlistId === playlist.id;
                      return (
                        <label key={playlist.id} className={[styles.gameCard, selected && styles.gameCardSelected].filter(Boolean).join(" ")}>
                          <input
                            type="radio"
                            name="contentSelection"
                            checked={selected}
                            onChange={() => setContentSelection({ type: "playlist", playlistId: playlist.id, contentToken: contentToken! })}
                            className={styles.gameCardRadio}
                          />
                          {selected && <span className={styles.gameCardChip}>SELECTED</span>}
                          <p className={styles.gameCardTitle}>{playlist.name}</p>
                          <p className={styles.contentCardMeta}>
                            {playlist.questionCount} question{playlist.questionCount === 1 ? "" : "s"}
                          </p>
                          <div className={styles.contentCardReadiness}>
                            <ReadinessBadge readiness={playlist.readiness} size="sm" />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {!contentToken && (
                    <p className={styles.contentStudioCta}>
                      Prepare your own board in the <Link href="/host/content">Content Studio</Link>.
                    </p>
                  )}
                  {contentToken && playlists.isError && (
                    <p className={styles.contentStudioCta}>Couldn&apos;t load your playlists — Default Mini Jeopardy is still available.</p>
                  )}
                  {/* Signed into Content Studio but never built a board —
                      a distinct state from "not signed in" above, per
                      product brief "Show Preparation" section 9: a Host
                      here shouldn't stare at a picker with only the sample
                      board in it and wonder if something's broken. */}
                  {noPlaylistsYet && (
                    <div className={styles.noPlaylistsYet}>
                      <p className={styles.noPlaylistsYetTitle}>You haven&apos;t created a Jeopardy board yet.</p>
                      <p className={styles.noPlaylistsYetHint}>Default Mini Jeopardy is ready to go, or build your own in a couple of minutes.</p>
                      <Link href="/host/content/jeopardy">
                        <Button size="sm" variant="secondary">
                          + Create a board
                        </Button>
                      </Link>
                    </div>
                  )}
                  {/* The backend genuinely refuses Start on an incomplete
                      board now (router.ts's game.start, PLAYLIST_NOT_READY)
                      — this banner gives the Host both real ways out
                      instead of a dead end (product brief "Show
                      Preparation" section 10). */}
                  {selectedPlaylist && (
                    <ContentReadinessNotice
                      contentTypeName="board"
                      readiness={selectedPlaylist.readiness}
                      reviewHref={
                        selectedPlaylist.readiness.firstProblem
                          ? `/host/content/jeopardy/playlists/${selectedPlaylist.id}?issue=${issueQueryParam(selectedPlaylist.readiness.firstProblem)}`
                          : `/host/content/jeopardy/playlists/${selectedPlaylist.id}`
                      }
                      onUseSample={() => setContentSelection({ type: "sample" })}
                    >
                      <ReadinessLine readiness={selectedPlaylist.readiness} />
                    </ContentReadinessNotice>
                  )}
                </div>
              )}

              {/* GeoGuessr's own content picker — same card grid/radio
                  pattern as Jeopardy's above (unchanged), reading the
                  geo-shaped list/readiness instead. Kept as a genuinely
                  separate block rather than parameterizing the Jeopardy
                  one over a generic shape: the two content shapes
                  (questionCount+categoryCount vs. roundCount) differ
                  enough that a forced-generic version would need as much
                  branching internally as two plain blocks do externally,
                  and this way Jeopardy's own JSX above is untouched. */}
              {selectedGameDefinition?.hasContentStudio && selectedGameKey === "geoguessr" && (
                <div className={styles.gameSelection} role="radiogroup" aria-label="Choose your content">
                  <p className={styles.gameSelectionLabel}>Choose your content</p>
                  <div className={styles.gameCardGrid}>
                    <label className={[styles.gameCard, contentSelection.type === "sample" && styles.gameCardSelected].filter(Boolean).join(" ")}>
                      <input
                        type="radio"
                        name="contentSelection"
                        checked={contentSelection.type === "sample"}
                        onChange={() => setContentSelection({ type: "sample" })}
                        className={styles.gameCardRadio}
                      />
                      {contentSelection.type === "sample" && <span className={styles.gameCardChip}>SELECTED</span>}
                      <p className={styles.gameCardTitle}>Default GeoGuessr</p>
                      <p className={styles.contentCardMeta}>Sample content</p>
                      <div className={styles.contentCardReadiness}>
                        <Badge variant="success" dot size="sm">
                          Ready
                        </Badge>
                      </div>
                    </label>
                    {geoPlaylists.data?.map((playlist) => {
                      const selected = contentSelection.type === "playlist" && contentSelection.playlistId === playlist.id;
                      return (
                        <label key={playlist.id} className={[styles.gameCard, selected && styles.gameCardSelected].filter(Boolean).join(" ")}>
                          <input
                            type="radio"
                            name="contentSelection"
                            checked={selected}
                            onChange={() => setContentSelection({ type: "playlist", playlistId: playlist.id, contentToken: contentToken! })}
                            className={styles.gameCardRadio}
                          />
                          {selected && <span className={styles.gameCardChip}>SELECTED</span>}
                          <p className={styles.gameCardTitle}>{playlist.name}</p>
                          <p className={styles.contentCardMeta}>
                            {playlist.roundCount} round{playlist.roundCount === 1 ? "" : "s"}
                          </p>
                          <div className={styles.contentCardReadiness}>
                            <ReadinessBadge readiness={playlist.readiness} size="sm" />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {!contentToken && (
                    <p className={styles.contentStudioCta}>
                      Prepare your own maps in the <Link href="/host/content">Content Studio</Link>.
                    </p>
                  )}
                  {contentToken && geoPlaylists.isError && (
                    <p className={styles.contentStudioCta}>Couldn&apos;t load your map sets — Default GeoGuessr is still available.</p>
                  )}
                  {noGeoPlaylistsYet && (
                    <div className={styles.noPlaylistsYet}>
                      <p className={styles.noPlaylistsYetTitle}>No GeoGuessr map sets yet.</p>
                      <p className={styles.noPlaylistsYetHint}>Default GeoGuessr is ready to go, or build your own maps in the Content Studio.</p>
                      <Link href="/host/content/geoguessr">
                        <Button size="sm" variant="secondary">
                          + Create your first map set
                        </Button>
                      </Link>
                    </div>
                  )}
                  {selectedGeoPlaylist && (
                    <ContentReadinessNotice
                      contentTypeName="map set"
                      readiness={selectedGeoPlaylist.readiness}
                      reviewHref={`/host/content/geoguessr/playlists/${selectedGeoPlaylist.id}`}
                      onUseSample={() => setContentSelection({ type: "sample" })}
                    >
                      <GeoReadinessLine readiness={selectedGeoPlaylist.readiness} />
                    </ContentReadinessNotice>
                  )}
                </div>
              )}

              {/* Drawing's own content picker — same card grid/radio
                  pattern as Jeopardy's/GeoGuessr's above, reading the
                  prompt-shaped list/readiness instead. Same "own block,
                  not a forced-generic one" reasoning as GeoGuessr's own
                  comment above. */}
              {selectedGameDefinition?.hasContentStudio && selectedGameKey === "drawing" && (
                <div className={styles.gameSelection} role="radiogroup" aria-label="Choose your content">
                  <p className={styles.gameSelectionLabel}>Choose your content</p>
                  <div className={styles.gameCardGrid}>
                    <label className={[styles.gameCard, contentSelection.type === "sample" && styles.gameCardSelected].filter(Boolean).join(" ")}>
                      <input
                        type="radio"
                        name="contentSelection"
                        checked={contentSelection.type === "sample"}
                        onChange={() => setContentSelection({ type: "sample" })}
                        className={styles.gameCardRadio}
                      />
                      {contentSelection.type === "sample" && <span className={styles.gameCardChip}>SELECTED</span>}
                      <p className={styles.gameCardTitle}>Default Drawing</p>
                      <p className={styles.contentCardMeta}>Sample content</p>
                      <div className={styles.contentCardReadiness}>
                        <Badge variant="success" dot size="sm">
                          Ready
                        </Badge>
                      </div>
                    </label>
                    {drawingPlaylists.data?.map((playlist) => {
                      const selected = contentSelection.type === "playlist" && contentSelection.playlistId === playlist.id;
                      return (
                        <label key={playlist.id} className={[styles.gameCard, selected && styles.gameCardSelected].filter(Boolean).join(" ")}>
                          <input
                            type="radio"
                            name="contentSelection"
                            checked={selected}
                            onChange={() => setContentSelection({ type: "playlist", playlistId: playlist.id, contentToken: contentToken! })}
                            className={styles.gameCardRadio}
                          />
                          {selected && <span className={styles.gameCardChip}>SELECTED</span>}
                          <p className={styles.gameCardTitle}>{playlist.name}</p>
                          <p className={styles.contentCardMeta}>
                            {playlist.promptCount} prompt{playlist.promptCount === 1 ? "" : "s"}
                          </p>
                          <div className={styles.contentCardReadiness}>
                            <ReadinessBadge readiness={playlist.readiness} size="sm" />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {!contentToken && (
                    <p className={styles.contentStudioCta}>
                      Prepare your own prompts in the <Link href="/host/content">Content Studio</Link>.
                    </p>
                  )}
                  {contentToken && drawingPlaylists.isError && (
                    <p className={styles.contentStudioCta}>Couldn&apos;t load your prompt lists — Default Drawing is still available.</p>
                  )}
                  {noDrawingPlaylistsYet && (
                    <div className={styles.noPlaylistsYet}>
                      <p className={styles.noPlaylistsYetTitle}>No Drawing prompt lists yet.</p>
                      <p className={styles.noPlaylistsYetHint}>Default Drawing is ready to go, or build your own prompts in the Content Studio.</p>
                      <Link href="/host/content/drawing">
                        <Button size="sm" variant="secondary">
                          + Create your first prompt list
                        </Button>
                      </Link>
                    </div>
                  )}
                  {selectedDrawingPlaylist && (
                    <ContentReadinessNotice
                      contentTypeName="prompt list"
                      readiness={selectedDrawingPlaylist.readiness}
                      reviewHref={`/host/content/drawing/playlists/${selectedDrawingPlaylist.id}`}
                      onUseSample={() => setContentSelection({ type: "sample" })}
                    >
                      <DrawingReadinessLine readiness={selectedDrawingPlaylist.readiness} />
                    </ContentReadinessNotice>
                  )}
                </div>
              )}

              {/* Music's own content picker — same card grid/radio
                  pattern as every other game's above, reading the
                  track-shaped list/readiness instead. Same "own block,
                  not a forced-generic one" reasoning as GeoGuessr's own
                  comment above. */}
              {selectedGameDefinition?.hasContentStudio && selectedGameKey === "music" && (
                <div className={styles.gameSelection} role="radiogroup" aria-label="Choose your content">
                  <p className={styles.gameSelectionLabel}>Choose your content</p>
                  <div className={styles.gameCardGrid}>
                    <label className={[styles.gameCard, contentSelection.type === "sample" && styles.gameCardSelected].filter(Boolean).join(" ")}>
                      <input
                        type="radio"
                        name="contentSelection"
                        checked={contentSelection.type === "sample"}
                        onChange={() => setContentSelection({ type: "sample" })}
                        className={styles.gameCardRadio}
                      />
                      {contentSelection.type === "sample" && <span className={styles.gameCardChip}>SELECTED</span>}
                      <p className={styles.gameCardTitle}>Default Guess the Music</p>
                      <p className={styles.contentCardMeta}>Sample content</p>
                      <div className={styles.contentCardReadiness}>
                        <Badge variant="success" dot size="sm">
                          Ready
                        </Badge>
                      </div>
                    </label>
                    {musicPlaylists.data?.map((playlist) => {
                      const selected = contentSelection.type === "playlist" && contentSelection.playlistId === playlist.id;
                      return (
                        <label key={playlist.id} className={[styles.gameCard, selected && styles.gameCardSelected].filter(Boolean).join(" ")}>
                          <input
                            type="radio"
                            name="contentSelection"
                            checked={selected}
                            onChange={() => setContentSelection({ type: "playlist", playlistId: playlist.id, contentToken: contentToken! })}
                            className={styles.gameCardRadio}
                          />
                          {selected && <span className={styles.gameCardChip}>SELECTED</span>}
                          <p className={styles.gameCardTitle}>{playlist.name}</p>
                          <p className={styles.contentCardMeta}>
                            {playlist.trackCount} track{playlist.trackCount === 1 ? "" : "s"}
                          </p>
                          <div className={styles.contentCardReadiness}>
                            <ReadinessBadge readiness={playlist.readiness} size="sm" />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {!contentToken && (
                    <p className={styles.contentStudioCta}>
                      Prepare your own playlists in the <Link href="/host/content">Content Studio</Link>.
                    </p>
                  )}
                  {contentToken && musicPlaylists.isError && (
                    <p className={styles.contentStudioCta}>Couldn&apos;t load your playlists — Default Guess the Music is still available.</p>
                  )}
                  {noMusicPlaylistsYet && (
                    <div className={styles.noPlaylistsYet}>
                      <p className={styles.noPlaylistsYetTitle}>No Guess the Music playlists yet.</p>
                      <p className={styles.noPlaylistsYetHint}>Default Guess the Music is ready to go, or upload your own clips in the Content Studio.</p>
                      <Link href="/host/content/music">
                        <Button size="sm" variant="secondary">
                          + Create your first playlist
                        </Button>
                      </Link>
                    </div>
                  )}
                  {selectedMusicPlaylist && (
                    <ContentReadinessNotice
                      contentTypeName="playlist"
                      readiness={selectedMusicPlaylist.readiness}
                      reviewHref={`/host/content/music/playlists/${selectedMusicPlaylist.id}`}
                      onUseSample={() => setContentSelection({ type: "sample" })}
                    >
                      <MusicReadinessLine readiness={selectedMusicPlaylist.readiness} />
                    </ContentReadinessNotice>
                  )}
                </div>
              )}

              {/* Steam Ratings' own content picker — same card grid/radio
                  pattern as every other game's above, reading the
                  game-shaped list/readiness instead. Same "own block,
                  not a forced-generic one" reasoning as GeoGuessr's own
                  comment above. */}
              {selectedGameDefinition?.hasContentStudio && selectedGameKey === "steamRatings" && (
                <div className={styles.gameSelection} role="radiogroup" aria-label="Choose your content">
                  <p className={styles.gameSelectionLabel}>Choose your content</p>
                  <div className={styles.gameCardGrid}>
                    <label className={[styles.gameCard, contentSelection.type === "sample" && styles.gameCardSelected].filter(Boolean).join(" ")}>
                      <input
                        type="radio"
                        name="contentSelection"
                        checked={contentSelection.type === "sample"}
                        onChange={() => setContentSelection({ type: "sample" })}
                        className={styles.gameCardRadio}
                      />
                      {contentSelection.type === "sample" && <span className={styles.gameCardChip}>SELECTED</span>}
                      <p className={styles.gameCardTitle}>Default Guess the Game</p>
                      <p className={styles.contentCardMeta}>Sample content</p>
                      <div className={styles.contentCardReadiness}>
                        <Badge variant="success" dot size="sm">
                          Ready
                        </Badge>
                      </div>
                    </label>
                    {steamPlaylists.data?.map((playlist) => {
                      const selected = contentSelection.type === "playlist" && contentSelection.playlistId === playlist.id;
                      return (
                        <label key={playlist.id} className={[styles.gameCard, selected && styles.gameCardSelected].filter(Boolean).join(" ")}>
                          <input
                            type="radio"
                            name="contentSelection"
                            checked={selected}
                            onChange={() => setContentSelection({ type: "playlist", playlistId: playlist.id, contentToken: contentToken! })}
                            className={styles.gameCardRadio}
                          />
                          {selected && <span className={styles.gameCardChip}>SELECTED</span>}
                          <p className={styles.gameCardTitle}>{playlist.name}</p>
                          <p className={styles.contentCardMeta}>
                            {playlist.gameCount} game{playlist.gameCount === 1 ? "" : "s"}
                          </p>
                          <div className={styles.contentCardReadiness}>
                            <ReadinessBadge readiness={playlist.readiness} size="sm" />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {!contentToken && (
                    <p className={styles.contentStudioCta}>
                      Prepare your own playlists in the <Link href="/host/content">Content Studio</Link>.
                    </p>
                  )}
                  {contentToken && steamPlaylists.isError && (
                    <p className={styles.contentStudioCta}>Couldn&apos;t load your playlists — Default Guess the Game is still available.</p>
                  )}
                  {noSteamPlaylistsYet && (
                    <div className={styles.noPlaylistsYet}>
                      <p className={styles.noPlaylistsYetTitle}>No Guess the Game playlists yet.</p>
                      <p className={styles.noPlaylistsYetHint}>Default Guess the Game is ready to go, or prepare your own games in the Content Studio.</p>
                      <Link href="/host/content/steamRatings">
                        <Button size="sm" variant="secondary">
                          + Create your first playlist
                        </Button>
                      </Link>
                    </div>
                  )}
                  {selectedSteamPlaylist && (
                    <ContentReadinessNotice
                      contentTypeName="playlist"
                      readiness={selectedSteamPlaylist.readiness}
                      reviewHref={`/host/content/steamRatings/playlists/${selectedSteamPlaylist.id}`}
                      onUseSample={() => setContentSelection({ type: "sample" })}
                    >
                      <SteamReadinessLine readiness={selectedSteamPlaylist.readiness} />
                    </ContentReadinessNotice>
                  )}
                </div>
              )}

              {/* Guess the Price's own content picker — same card grid/radio
                  pattern as every other game's above, reading the
                  item-shaped list/readiness instead. Same "own block,
                  not a forced-generic one" reasoning as GeoGuessr's own
                  comment above. */}
              {selectedGameDefinition?.hasContentStudio && selectedGameKey === "guessThePrice" && (
                <div className={styles.gameSelection} role="radiogroup" aria-label="Choose your content">
                  <p className={styles.gameSelectionLabel}>Choose your content</p>
                  <div className={styles.gameCardGrid}>
                    <label className={[styles.gameCard, contentSelection.type === "sample" && styles.gameCardSelected].filter(Boolean).join(" ")}>
                      <input
                        type="radio"
                        name="contentSelection"
                        checked={contentSelection.type === "sample"}
                        onChange={() => setContentSelection({ type: "sample" })}
                        className={styles.gameCardRadio}
                      />
                      {contentSelection.type === "sample" && <span className={styles.gameCardChip}>SELECTED</span>}
                      <p className={styles.gameCardTitle}>Default Guess the Price</p>
                      <p className={styles.contentCardMeta}>Sample content</p>
                      <div className={styles.contentCardReadiness}>
                        <Badge variant="success" dot size="sm">
                          Ready
                        </Badge>
                      </div>
                    </label>
                    {pricePlaylists.data?.map((playlist) => {
                      const selected = contentSelection.type === "playlist" && contentSelection.playlistId === playlist.id;
                      return (
                        <label key={playlist.id} className={[styles.gameCard, selected && styles.gameCardSelected].filter(Boolean).join(" ")}>
                          <input
                            type="radio"
                            name="contentSelection"
                            checked={selected}
                            onChange={() => setContentSelection({ type: "playlist", playlistId: playlist.id, contentToken: contentToken! })}
                            className={styles.gameCardRadio}
                          />
                          {selected && <span className={styles.gameCardChip}>SELECTED</span>}
                          <p className={styles.gameCardTitle}>{playlist.name}</p>
                          <p className={styles.contentCardMeta}>
                            {playlist.itemCount} item{playlist.itemCount === 1 ? "" : "s"}
                          </p>
                          <div className={styles.contentCardReadiness}>
                            <ReadinessBadge readiness={playlist.readiness} size="sm" />
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  {!contentToken && (
                    <p className={styles.contentStudioCta}>
                      Prepare your own playlists in the <Link href="/host/content">Content Studio</Link>.
                    </p>
                  )}
                  {contentToken && pricePlaylists.isError && (
                    <p className={styles.contentStudioCta}>Couldn&apos;t load your playlists — Default Guess the Price is still available.</p>
                  )}
                  {noPricePlaylistsYet && (
                    <div className={styles.noPlaylistsYet}>
                      <p className={styles.noPlaylistsYetTitle}>No Guess the Price playlists yet.</p>
                      <p className={styles.noPlaylistsYetHint}>Default Guess the Price is ready to go, or prepare your own items in the Content Studio.</p>
                      <Link href="/host/content/guessThePrice">
                        <Button size="sm" variant="secondary">
                          + Create your first playlist
                        </Button>
                      </Link>
                    </div>
                  )}
                  {selectedPricePlaylist && (
                    <ContentReadinessNotice
                      contentTypeName="playlist"
                      readiness={selectedPricePlaylist.readiness}
                      reviewHref={`/host/content/guessThePrice/playlists/${selectedPricePlaylist.id}`}
                      onUseSample={() => setContentSelection({ type: "sample" })}
                    >
                      <PriceReadinessLine readiness={selectedPricePlaylist.readiness} />
                    </ContentReadinessNotice>
                  )}
                </div>
              )}

              {/* `sequenceActive` (GameStartingSequence, rendered above
                  this whole phase-driven block once it's true — see
                  below) takes over the instant this button is clicked,
                  so in practice this plain row is what's showing
                  whenever the Lobby itself is visible. */}
              <div className={styles.startRow}>
                <Button size="lg" onClick={handleStartGame} disabled={startBlocked}>
                  {startLabel}
                </Button>
                {start.error && <p className={styles.errorBanner}>{readableSessionError(start.error.data?.sessionErrorCode, start.error.message)}</p>}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Chat" />
            <CardBody>
              <GameChatPanel role="HOST" displayName={identity.displayName} participantId={identity.participantId} sendChatMessage={sendChatMessage} />
            </CardBody>
          </Card>
        </>
      )}

      {phase === "GAME_IN_PROGRESS" && gameState && (
        <div className={styles.layout}>
          <div className={styles.main}>
            {gameKey === "geoguessr" ? (
              <HostGeoPanel state={rawGameState as unknown as GeoGuessrState} sendAction={sendAction} />
            ) : gameKey === "drawing" ? (
              <HostDrawingPanel state={rawGameState as unknown as DrawingState} sendAction={sendAction} requestDrawingSnapshot={requestDrawingSnapshot} />
            ) : gameKey === "music" ? (
              <HostMusicPanel state={rawGameState as unknown as MusicState} sendAction={sendAction} />
            ) : gameKey === "steamRatings" ? (
              <HostSteamPanel state={rawGameState as unknown as SteamRatingsState} sendAction={sendAction} />
            ) : gameKey === "guessThePrice" ? (
              <HostPricePanel state={rawGameState as unknown as GuessThePriceState} sendAction={sendAction} />
            ) : gameKey === "pointingSystem" ? (
              <HostPointingPanel state={rawGameState as unknown as PointingSystemState} sendAction={sendAction} />
            ) : (
              <HostBoardPanel state={rawGameState as unknown as BoardQuestionState} lastEvents={lastEvents} sendAction={sendAction} />
            )}
          </div>
          <div className={styles.sidebar}>
            {/* "GAME SCORE vs MATCH SCORE, never confused" — the two
                numbers sit in the SAME card, explicitly labeled. Reads
                `roster.matchScore` exactly as computed server-side —
                every finished game counts toward it, this one included,
                no exceptions. */}
            {roster && (
              <Card variant="raised">
                <CardBody>
                  <div className={styles.showControlHeader}>
                    <div>
                      <p className={styles.showControlEyebrow}>Current game</p>
                      <p className={styles.showControlGame}>{games.find((g) => g.id === gameKey)?.label ?? "Game"}</p>
                    </div>
                    <Badge variant="warning">+1 point on win</Badge>
                  </div>
                  {currentContentLabel && <p className={styles.showControlContent}>Content: {currentContentLabel}</p>}
                  <div className={styles.showControlScores}>
                    <div className={styles.showControlScoreBlock}>
                      <p className={styles.showControlScoreLabel}>Game score</p>
                      <p className={styles.showControlScoreSub}>points in this game</p>
                      <div className={styles.showControlScoreRow}>
                        <span className={styles.showControlScoreA}>{gameState.scores.TEAM_A}</span>
                        <span className={styles.showControlScoreB}>{gameState.scores.TEAM_B}</span>
                      </div>
                    </div>
                    <div className={styles.showControlScoreBlock}>
                      <p className={styles.showControlScoreLabel}>Match score</p>
                      <p className={styles.showControlScoreSub}>games won so far</p>
                      <div className={styles.showControlScoreRow}>
                        <span className={styles.showControlScoreA}>{roster.matchScore.TEAM_A}</span>
                        <span className={styles.showControlScoreB}>{roster.matchScore.TEAM_B}</span>
                      </div>
                    </div>
                  </div>
                </CardBody>
              </Card>
            )}
            {roster && (
              <Card>
                <CardHeader title="Roster" />
                <CardBody>
                  <div className={styles.rosterGrid}>
                    <TeamRoster
                      teamName="Team A"
                      variant="teamA"
                      seats={toRosterSeats(roster.teamA, presence, "TEAM_A")}
                      onKick={(id, displayName) => setKickTarget({ id, displayName })}
                      kickingId={kick.isPending ? kickTarget?.id : null}
                    />
                    <TeamRoster
                      teamName="Team B"
                      variant="teamB"
                      seats={toRosterSeats(roster.teamB, presence, "TEAM_B")}
                      onKick={(id, displayName) => setKickTarget({ id, displayName })}
                      kickingId={kick.isPending ? kickTarget?.id : null}
                    />
                  </div>
                </CardBody>
              </Card>
            )}
            <Card>
              <CardHeader title="Chat" />
              <CardBody>
                <GameChatPanel role="HOST" displayName={identity.displayName} participantId={identity.participantId} sendChatMessage={sendChatMessage} />
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
