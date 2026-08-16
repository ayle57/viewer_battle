"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { trpc } from "@/app/_trpc/client";
import { TRPCClientError } from "@trpc/client";
import { Button, Card, CardBody, CardHeader, Input } from "@/ui";
import { useContentIdentityStore } from "./_shared/contentIdentityStore";
import styles from "./layout.module.css";

/**
 * Gates every /host/content/* route behind a Content Studio identity
 * (ContentHost — see prisma/schema.prisma's "Content Studio" comment),
 * NOT the live-session Host identity from src/app/_shared/identityStore.ts
 * — a Host can be preparing content with no session running at all. Same
 * shape as /host's own HostConnexion gate (src/app/host/page.tsx): one
 * password proves "I'm allowed to do Host things," then everything below
 * renders. Player/Display never see this screen — there's no route that
 * links here from /player or /display, and every server-side mutation
 * independently re-checks the token anyway (never trust the UI as the
 * boundary — see src/server/trpc/contentRouter.ts).
 *
 * No visible chrome of its own beyond the page shell/gate — each page
 * renders its own `StudioBreadcrumb` (_shared/StudioBreadcrumb.tsx) with
 * the exact trail for its own depth (Content Studio -> Jeopardy -> a
 * playlist name), since a single fixed breadcrumb here couldn't know how
 * deep any given page actually is.
 */
export default function ContentStudioLayout({ children }: { children: ReactNode }) {
  const token = useContentIdentityStore((s) => s.token);
  const clearToken = useContentIdentityStore((s) => s.clearToken);
  const me = trpc.content.auth.me.useQuery({ token: token ?? "" }, { enabled: Boolean(token), retry: false });

  useEffect(() => {
    // A stored token that no longer resolves (cleared DB, dev reset, …)
    // must fall back to the login screen instead of hanging on a
    // perpetually-erroring query — same "lost token = lost identity"
    // honesty as every other auth surface in this app.
    if (me.isError) clearToken();
  }, [me.isError, clearToken]);

  const authenticated = Boolean(token) && me.data?.ok === true;
  // A stored token still being verified — a brief, neutral beat, not the
  // login form (that would flash-then-vanish for the common "already
  // signed in" case, which is most page loads).
  const checkingStoredToken = Boolean(token) && me.isLoading;

  return (
    <main className={styles.page}>
      {authenticated ? children : checkingStoredToken ? <div className={styles.gate} aria-live="polite" /> : <ContentStudioLogin />}
    </main>
  );
}

function ContentStudioLogin() {
  const setToken = useContentIdentityStore((s) => s.setToken);
  const [hostPassword, setHostPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = trpc.content.auth.login.useMutation();

  async function handleSubmit() {
    const password = hostPassword.trim();
    if (!password) return;
    setError(null);
    try {
      const result = await login.mutateAsync({ hostPassword: password });
      setToken(result.token);
    } catch (err) {
      setError(err instanceof TRPCClientError ? err.message : "Couldn't sign in — try again.");
    }
  }

  return (
    <div className={styles.gate}>
      <Link href="/host" className={styles.hostLobbyLink}>
        ← Host Lobby
      </Link>
      <Card variant="raised" className={styles.gateCard}>
        <CardHeader title="Content Studio" subtitle="Build the games your audience will remember." />
        <CardBody>
          <form
            className={styles.gateForm}
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <Input
              size="lg"
              type="password"
              label="Host password"
              value={hostPassword}
              onChange={(event) => setHostPassword(event.target.value)}
              placeholder="Only the streamer knows this"
              autoFocus
            />
            {error && <p className={styles.errorBanner}>{error}</p>}
            <Button size="lg" type="submit" loading={login.isPending} disabled={!hostPassword.trim()} fullWidth>
              Enter Content Studio
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
