"use client";

import { useState } from "react";
import { trpc } from "@/app/_trpc/client";
import { Avatar, Button, ConfirmDialog, Input } from "@/ui";
import { useContentIdentityStore } from "../_shared/contentIdentityStore";
import { formatRelativeTime } from "../_shared/relativeTime";
import { StudioBreadcrumb } from "../_shared/StudioBreadcrumb";
import styles from "./page.module.css";

/**
 * The operator's admin dashboard — real `User` accounts + platform-wide
 * stats. Gated by the SAME ContentHost token as the rest of /host/content/*
 * (this route renders behind ContentStudioLayout's own gate, one level
 * up — see src/server/trpc/adminRouter.ts's own doc comment for why this
 * deliberately isn't a fourth login screen of its own).
 */
export default function AdminPage() {
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const utils = trpc.useUtils();

  const overview = trpc.admin.overview.useQuery({ token }, { enabled: Boolean(token) });
  const users = trpc.admin.users.useQuery({ token }, { enabled: Boolean(token) });
  const deleteUser = trpc.admin.deleteUser.useMutation({
    onSuccess: () => {
      void utils.admin.users.invalidate();
      void utils.admin.overview.invalidate();
    },
  });

  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDeleteUser = users.data?.find((u) => u.userId === pendingDeleteId) ?? null;

  return (
    <>
      <StudioBreadcrumb crumbs={[{ label: "Content Studio", href: "/host/content" }, { label: "Admin" }]} />

      <div className={styles.header}>
        <h1 className={styles.title}>Admin</h1>
        <p className={styles.subtitle}>Real accounts your viewers created, and how the platform&rsquo;s actually being used.</p>
      </div>

      {overview.data && (
        <div className={styles.statsGrid}>
          <StatTile label="Accounts" value={overview.data.totalUsers} />
          <StatTile label="Sessions" value={overview.data.totalSessions} />
          <StatTile label="Games finished" value={overview.data.totalGamesFinished} />
          <StatTile label="Sessions with an account playing" value={overview.data.sessionsWithAnAccountPlaying} />
        </div>
      )}

      <div className={styles.tableWrap}>
        {users.isLoading ? (
          <p className={styles.empty}>Loading accounts…</p>
        ) : !users.data || users.data.length === 0 ? (
          <p className={styles.empty}>No one has created an account yet.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Account</th>
                <th>Created</th>
                <th>Record (W–T–L)</th>
                <th>Win rate</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {users.data.map((user) => {
                const winRate = user.stats.gamesPlayed > 0 ? `${Math.round((user.stats.gamesWon / user.stats.gamesPlayed) * 100)}%` : "—";
                return (
                  <tr key={user.userId}>
                    <td className={styles.username}>
                      <Avatar name={user.username} />
                      {user.username}
                      {user.isAdmin && <span className={styles.adminBadge}>Admin</span>}
                    </td>
                    <td className={styles.muted}>{formatRelativeTime(user.createdAt)}</td>
                    <td className={styles.muted}>
                      {user.stats.gamesWon}–{user.stats.gamesTied}–{user.stats.gamesLost}
                    </td>
                    <td>{winRate}</td>
                    <td>
                      {user.isAdmin ? (
                        <span className={styles.protected} title="The streamer's own account can't be deleted here.">
                          Protected
                        </span>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => setPendingDeleteId(user.userId)}>
                          Delete
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(pendingDeleteUser)}
        title="Delete this account?"
        description={
          pendingDeleteUser
            ? `"${pendingDeleteUser.username}" will no longer be able to log in, and their stats page will be gone. The games they already played stay in the show's history — they just won't be attributed to anyone anymore.`
            : ""
        }
        confirmLabel="Delete account"
        danger
        confirming={deleteUser.isPending}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (!pendingDeleteUser) return;
          // Closes ONLY on success — same contract as the playlist delete
          // flows (jeopardy/page.tsx, geoguessr/page.tsx): a server
          // refusal keeps the dialog open with the real error showing
          // below, instead of silently closing and letting the host
          // believe the account is gone when it never actually was.
          deleteUser.mutate({ token, userId: pendingDeleteUser.userId }, { onSuccess: () => setPendingDeleteId(null) });
        }}
      >
        {deleteUser.isError && <p className={styles.errorBanner}>{deleteUser.error.message}</p>}
      </ConfirmDialog>

      <ChatWordFilter token={token} />
    </>
  );
}

/**
 * The operator-curated chat blocklist (see src/domain/chat/wordFilter.ts).
 * Applies to PLAYER chat only — a hit blocks the whole message and the
 * sender is told why. The list is seeded with a sensible default set the
 * first time it's empty; this is where the operator trims or extends it.
 */
function ChatWordFilter({ token }: { token: string }) {
  const utils = trpc.useUtils();
  const words = trpc.admin.blockedWords.useQuery({ token }, { enabled: Boolean(token) });
  const add = trpc.admin.addBlockedWord.useMutation({ onSuccess: () => void utils.admin.blockedWords.invalidate() });
  const remove = trpc.admin.removeBlockedWord.useMutation({ onSuccess: () => void utils.admin.blockedWords.invalidate() });
  const [draft, setDraft] = useState("");

  function submit() {
    const value = draft.trim();
    if (!value) return;
    add.mutate(
      { token, word: value },
      {
        onSuccess: () => setDraft(""),
      },
    );
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>Chat word filter</h2>
      <p className={styles.sectionSubtitle}>
        Words on this list block a player&rsquo;s chat message before anyone sees it. Host and Display messages are never
        filtered. Matching ignores case, accents, spacing and common letter swaps ({" "}
        <code>c0nn4rd</code>, <code>c o n n a r d</code>).
      </p>

      <div className={styles.filterCard}>
        <form
          className={styles.addRow}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Input
            size="md"
            aria-label="Add a word to the filter"
            placeholder="Add a word…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            error={add.isError ? add.error.message : undefined}
          />
          <Button size="md" type="submit" loading={add.isPending} disabled={!draft.trim()}>
            Add
          </Button>
        </form>

        {words.isLoading ? (
          <p className={styles.empty}>Loading…</p>
        ) : !words.data || words.data.length === 0 ? (
          <p className={styles.empty}>No words filtered — player chat is unrestricted.</p>
        ) : (
          <div className={styles.wordGrid}>
            {words.data.map((entry) => (
              <span key={entry.id} className={styles.wordChip}>
                {entry.word}
                <button
                  type="button"
                  className={styles.wordChipRemove}
                  aria-label={`Remove "${entry.word}" from the filter`}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ token, id: entry.id })}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <p className={styles.filterHint}>
          {words.data?.length ?? 0} word{(words.data?.length ?? 0) === 1 ? "" : "s"} on the list. Changes take effect
          within about 15 seconds for messages already in flight.
        </p>
      </div>
    </section>
  );
}

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className={styles.statTile}>
      <span className={styles.statValue}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}
