"use client";

import { useState } from "react";
import { trpc } from "@/app/_trpc/client";
import { Button, ConfirmDialog } from "@/ui";
import { getInitials } from "@/ui/initials";
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
                      <span className={styles.avatar} aria-hidden="true">
                        {getInitials(user.username)}
                      </span>
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
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (pendingDeleteUser) deleteUser.mutate({ token, userId: pendingDeleteUser.userId });
          setPendingDeleteId(null);
        }}
      />
    </>
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
