"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TRPCClientError } from "@trpc/client";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, Card, CardBody, CardHeader, Input } from "@/ui";
import { useAccountStore, type Account } from "@/app/_shared/accountStore";
import styles from "./page.module.css";

/**
 * The real, persistent `User` account page — login/register when signed
 * out, a small profile (stats + change username/password + log out) when
 * signed in. Deliberately its own top-level route (not nested under
 * /player or /host) since an account is meant to be usable from any role
 * — a viewer might sign in before ever joining a game, a Host might have
 * one too — see accountStore.ts's own doc comment on why this is a
 * FOURTH, separate identity system from the other three in this app.
 *
 * Genuinely low-stakes by design (prisma/schema.prisma's own User doc
 * comment) — the copy on this page says so explicitly rather than
 * pretending otherwise: no email, no password reset, a throwaway
 * password is the RIGHT choice here, not a corner being cut.
 */
export default function AccountPage() {
  const account = useAccountStore((s) => s.account);
  return (
    <main className={styles.page}>
      <div className={styles.wrap}>
        {/* An explicit, unmissable way back — one link doing double duty
            as the brand mark AND an obvious nav affordance (the "←"),
            rather than a plain wordmark that reads as a logo, not
            something to click. */}
        <Link href="/" className={`${styles.brand} vb-wordmark-transition`}>
          ← VIEWERBATTLE
        </Link>
        {account ? <AccountProfile account={account} /> : <AccountAuth />}
      </div>
    </main>
  );
}

function AccountAuth() {
  const setAccount = useAccountStore((s) => s.setAccount);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = trpc.user.login.useMutation();
  const register = trpc.user.register.useMutation();
  const pending = login.isPending || register.isPending;

  async function handleSubmit() {
    setError(null);
    try {
      const result = mode === "login" ? await login.mutateAsync({ username, password }) : await register.mutateAsync({ username, password });
      setAccount({ token: result.token, username: result.username, isAdmin: result.isAdmin });
    } catch (err) {
      setError(err instanceof TRPCClientError ? err.message : "Something went wrong — try again.");
    }
  }

  return (
    <Card variant="raised">
      <CardHeader
        title={mode === "login" ? "Log in" : "Create an account"}
        subtitle={mode === "login" ? "Track your stats across every show you play." : "A pseudo, a password, and you're set."}
      />
      <CardBody>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Input size="lg" label="Username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. Nadia" autoFocus />
          <div>
            <Input size="lg" type="password" label="Password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Anything you'll remember" />
            {mode === "register" && (
              <p className={styles.hint}>Just for stats and bragging rights — no email, no password reset. A throwaway password is fine.</p>
            )}
          </div>
          {error && <p className={styles.errorBanner}>{error}</p>}
          <Button size="lg" type="submit" loading={pending} disabled={!username.trim() || !password} fullWidth>
            {mode === "login" ? "Log in" : "Create account"}
          </Button>
        </form>
        <button type="button" className={styles.switchMode} onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "New here? Create an account" : "Already have an account? Log in"}
        </button>
      </CardBody>
    </Card>
  );
}

function AccountProfile({ account }: { account: Account }) {
  const clearAccount = useAccountStore((s) => s.clearAccount);
  const logout = trpc.user.logout.useMutation();
  // A REAL, REPRODUCED "remember me" bug this closes: `retry: false` +
  // clearing the account on ANY query error meant a single dropped
  // request — a flaky connection, the dev server mid-restart, a cold
  // Postgres connection — silently signed someone out, indistinguishable
  // from a genuinely invalid token. `retry` below only gives up
  // immediately on a DEFINITIVE rejection (the server explicitly saying
  // this token doesn't resolve to anyone — `userErrorCode: "INVALID_TOKEN"`,
  // the one error resolveUserByToken can throw); anything else (a network
  // blip, a transient 5xx) gets a couple of retries first, same as this
  // app already does nowhere else needed it until now, since every other
  // identity check here has always run once, on a real connection, at
  // join time — this is the first one that has to survive an already-
  // signed-in visitor's browser just sitting there.
  const me = trpc.user.me.useQuery(
    { token: account.token },
    {
      retry: (failureCount, error) => {
        const code = error instanceof TRPCClientError ? error.data?.userErrorCode : undefined;
        if (code === "INVALID_TOKEN") return false;
        return failureCount < 2;
      },
    },
  );

  async function handleLogout() {
    await logout.mutateAsync({ token: account.token }).catch(() => undefined); // best-effort — sign out locally either way
    clearAccount();
  }

  // A stored token that DEFINITIVELY no longer resolves (logged out
  // elsewhere, deleted by an admin) — same "lost token = lost identity"
  // honesty as every other auth surface in this app (see
  // ContentStudioLayout's identical reasoning). A plain `useEffect`, not
  // a synchronous call during render — clearing account state is a real
  // side effect, and this only ever fires after `retry` above has
  // already ruled out every transient explanation.
  const tokenDefinitivelyInvalid =
    me.isError && me.error instanceof TRPCClientError && me.error.data?.userErrorCode === "INVALID_TOKEN";
  useEffect(() => {
    if (tokenDefinitivelyInvalid) clearAccount();
  }, [tokenDefinitivelyInvalid, clearAccount]);
  if (tokenDefinitivelyInvalid) return null;

  // Any OTHER error (still retrying, or exhausted retries on something
  // that was never actually about this token — a real outage) keeps the
  // account signed in and just shows stats as unavailable for now,
  // rather than bouncing back to the login form for a problem that has
  // nothing to do with whether this person is who they say they are.
  const statsUnavailable = me.isError;

  const stats = me.data?.stats;
  const winRate = stats && stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : null;

  return (
    <div className={styles.profileStack}>
      {/* Only ever rendered for a real `isAdmin` account —
          see router.ts's session.create doc comment / User.isAdmin's own
          comment (prisma/schema.prisma) for why that flag exists at
          all. Links to /host/content/admin, which has its own separate
          ContentHost-token gate (unchanged) — same "just navigate there,
          the destination handles its own auth" pattern host/page.tsx's
          own "Go to the Content Studio" footer link already uses, not a
          new access-control mechanism. */}
      {(me.data?.isAdmin ?? account.isAdmin) && (
        <Link href="/host/content/admin" className={styles.adminPanelLink}>
          <span>🛡️ Streamer account</span>
          <span className={styles.adminPanelLinkArrow}>Admin panel →</span>
        </Link>
      )}
      <Card variant="raised">
        <CardHeader title={account.username} subtitle="Signed in" />
        <CardBody>
          {statsUnavailable ? (
            <p className={styles.hint}>Couldn&rsquo;t reach the server to load your stats right now — you&rsquo;re still signed in, this will fix itself once the connection&rsquo;s back.</p>
          ) : (
            <div className={styles.statsGrid}>
              <StatTile label="Played" value={stats?.gamesPlayed} />
              <StatTile label="Won" value={stats?.gamesWon} />
              <StatTile label="Tied" value={stats?.gamesTied} />
              <StatTile label="Lost" value={stats?.gamesLost} />
            </div>
          )}
          <div className={styles.profileFooter}>
            {winRate !== null ? (
              <Badge variant="success" dot>
                {winRate}% win rate
              </Badge>
            ) : (
              <span />
            )}
            <Button variant="ghost" onClick={() => void handleLogout()} loading={logout.isPending}>
              Log out
            </Button>
          </div>
        </CardBody>
      </Card>

      <ChangeUsernameCard token={account.token} currentUsername={account.username} />
      <ChangePasswordCard token={account.token} />
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className={styles.statTile}>
      <span className={styles.statValue}>{value ?? "—"}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

function ChangeUsernameCard({ token, currentUsername }: { token: string; currentUsername: string }) {
  const setAccount = useAccountStore((s) => s.setAccount);
  const [newUsername, setNewUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const changeUsername = trpc.user.changeUsername.useMutation();

  async function handleSubmit() {
    setError(null);
    setDone(false);
    try {
      const result = await changeUsername.mutateAsync({ token, newUsername });
      setAccount({ token, username: result.username, isAdmin: result.isAdmin });
      setNewUsername("");
      setDone(true);
    } catch (err) {
      setError(err instanceof TRPCClientError ? err.message : "Couldn't change your username — try again.");
    }
  }

  return (
    <Card>
      <CardHeader title="Change username" subtitle={`Currently "${currentUsername}"`} />
      <CardBody>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Input size="md" label="New username" value={newUsername} onChange={(event) => setNewUsername(event.target.value)} placeholder="e.g. Nadia2" />
          {error && <p className={styles.errorBanner}>{error}</p>}
          {done && <p className={styles.successBanner}>Username updated.</p>}
          <Button size="md" type="submit" loading={changeUsername.isPending} disabled={!newUsername.trim()}>
            Save
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function ChangePasswordCard({ token }: { token: string }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const changePassword = trpc.user.changePassword.useMutation();

  async function handleSubmit() {
    setError(null);
    setDone(false);
    try {
      await changePassword.mutateAsync({ token, currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setDone(true);
    } catch (err) {
      setError(err instanceof TRPCClientError ? err.message : "Couldn't change your password — try again.");
    }
  }

  return (
    <Card>
      <CardHeader title="Change password" />
      <CardBody>
        <form
          className={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Input size="md" type="password" label="Current password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
          <div>
            <Input size="md" type="password" label="New password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            <p className={styles.hint}>Still just for stats — a throwaway password is fine here too.</p>
          </div>
          {error && <p className={styles.errorBanner}>{error}</p>}
          {done && <p className={styles.successBanner}>Password updated.</p>}
          <Button size="md" type="submit" loading={changePassword.isPending} disabled={!currentPassword || !newPassword}>
            Save
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
