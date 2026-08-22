"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { trpc } from "@/app/_trpc/client";
import { Button, ConfirmDialog, Dialog, Input } from "@/ui";
import { fadeUp, staggerContainer, EASE_OUT_EXPO } from "@/app/_shared/motion/variants";
import { useContentIdentityStore } from "../_shared/contentIdentityStore";
import { formatRelativeTime } from "../_shared/relativeTime";
import { StudioBreadcrumb } from "../_shared/StudioBreadcrumb";
import { ActionsMenu } from "@/app/_shared/ActionsMenu";
import { ReadinessBadge } from "../_shared/ReadinessBadge";
import styles from "./page.module.css";

const GAME_KEY = "board-question" as const;

export default function JeopardyContentPage() {
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const utils = trpc.useUtils();
  const router = useRouter();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  const playlists = trpc.content.playlist.list.useQuery({ token, gameKey: GAME_KEY }, { enabled: Boolean(token) });
  const createPlaylist = trpc.content.playlist.create.useMutation({
    onSuccess: (playlist) => {
      void utils.content.playlist.list.invalidate();
      router.push(`/host/content/jeopardy/playlists/${playlist.id}`);
    },
  });
  const duplicatePlaylist = trpc.content.playlist.duplicate.useMutation({
    onSuccess: () => void utils.content.playlist.list.invalidate(),
  });
  const deletePlaylist = trpc.content.playlist.delete.useMutation({
    onSuccess: () => void utils.content.playlist.list.invalidate(),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDeletePlaylist = playlists.data?.find((p) => p.id === pendingDeleteId) ?? null;

  return (
    <>
      <StudioBreadcrumb crumbs={[{ label: "Content Studio", href: "/host/content" }, { label: "Jeopardy" }]} />

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Jeopardy</h1>
          <p className={styles.subtitle}>Mini Jeopardy — question board, categories, playlists.</p>
        </div>
        <Button size="lg" onClick={() => setCreateOpen(true)}>
          + Create playlist
        </Button>
      </div>

      {playlists.data && playlists.data.length > 0 && <p className={styles.sectionLabel}>Your Playlists</p>}

      {playlists.isLoading && (
        <div className={styles.loadingGrid} aria-busy="true" aria-live="polite">
          <span className={styles.loadingCard} />
          <span className={styles.loadingCard} />
          <span className={styles.loadingCard} />
        </div>
      )}

      {playlists.isError && (
        <div className={styles.errorState}>
          <p className={styles.emptyTitle}>Couldn&apos;t load your playlists.</p>
          <p>{playlists.error.message}</p>
          <Button onClick={() => void playlists.refetch()}>Try again</Button>
        </div>
      )}

      {playlists.data && playlists.data.length === 0 && (
        <motion.div
          className={styles.emptyScene}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.15 : 0.5, ease: EASE_OUT_EXPO }}
        >
          <div className={styles.emptyBoardMotif} aria-hidden="true">
            {Array.from({ length: 9 }).map((_, i) => (
              <span key={i} className={styles.emptyBoardCell} />
            ))}
          </div>
          <p className={styles.emptyEyebrow}>First playlist</p>
          <h2 className={styles.emptyTitle}>Your first show starts here.</h2>
          <p className={styles.emptySubtitle}>Create a question board and make it yours.</p>
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            + Create playlist
          </Button>
        </motion.div>
      )}

      {playlists.data && playlists.data.length > 0 && (
        <motion.div className={styles.grid} variants={staggerContainer(reduced)} initial="hidden" animate="show">
          <AnimatePresence initial={false}>
            {playlists.data.map((playlist) => (
              <motion.div
                key={playlist.id}
                layout
                variants={fadeUp(reduced)}
                initial="hidden"
                animate="show"
                exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, transition: { duration: 0.18 } }}
                className={styles.playlistCard}
              >
                <div className={styles.playlistCardTop}>
                  <Link href={`/host/content/jeopardy/playlists/${playlist.id}`} className={styles.playlistName}>
                    {playlist.name}
                  </Link>
                  <ReadinessBadge readiness={playlist.readiness} size="sm" />
                </div>

                <p className={styles.playlistMeta}>
                  {playlist.categoryCount} categor{playlist.categoryCount === 1 ? "y" : "ies"} · {playlist.questionCount} question
                  {playlist.questionCount === 1 ? "" : "s"}
                </p>
                {playlist.description && <p className={styles.playlistDescription}>{playlist.description}</p>}

                <div className={styles.playlistFooter}>
                  <p className={styles.playlistUpdated}>Updated {formatRelativeTime(playlist.updatedAt)}</p>
                  <div className={styles.playlistActions}>
                    <Link href={`/host/content/jeopardy/playlists/${playlist.id}`}>
                      <Button variant="secondary" size="sm">
                        Edit
                      </Button>
                    </Link>
                    <ActionsMenu
                      items={[
                        { label: "Duplicate", onSelect: () => duplicatePlaylist.mutate({ token, playlistId: playlist.id }) },
                        { label: "Delete", danger: true, onSelect: () => setPendingDeleteId(playlist.id) },
                      ]}
                      label={`More actions for ${playlist.name}`}
                    />
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          <button type="button" className={styles.createCard} onClick={() => setCreateOpen(true)}>
            <span className={styles.createCardPlus} aria-hidden="true">
              +
            </span>
            Create playlist
          </button>
        </motion.div>
      )}

      <CreatePlaylistDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={(name, description) => createPlaylist.mutate({ token, gameKey: GAME_KEY, name, description })}
        pending={createPlaylist.isPending}
        error={createPlaylist.error?.message}
      />

      <ConfirmDialog
        open={pendingDeleteId !== null}
        title="Delete this playlist?"
        description={
          pendingDeletePlaylist
            ? `"${pendingDeletePlaylist.name}" and its ${pendingDeletePlaylist.questionCount} question${pendingDeletePlaylist.questionCount === 1 ? "" : "s"} will be permanently removed.`
            : "This will permanently remove this playlist and its questions."
        }
        confirmLabel="Delete playlist"
        danger
        confirming={deletePlaylist.isPending}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (!pendingDeleteId) return;
          // Closes ONLY on success — a server refusal (product brief
          // "Show Preparation" section 12) keeps the dialog open with the
          // real error showing below, instead of silently vanishing.
          deletePlaylist.mutate({ token, playlistId: pendingDeleteId }, { onSuccess: () => setPendingDeleteId(null) });
        }}
      >
        {deletePlaylist.isError && <p className={styles.errorBanner}>{deletePlaylist.error.message}</p>}
      </ConfirmDialog>
    </>
  );
}

function CreatePlaylistDialog({
  open,
  onClose,
  onCreate,
  pending,
  error,
}: {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string | undefined) => void;
  pending: boolean;
  error?: string;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  function handleClose() {
    setName("");
    setDescription("");
    onClose();
  }

  if (!open) return null;

  return (
    <Dialog open={open} onClose={handleClose} title="Create playlist" description="A new board, ready to fill in." size="lg">
      <div className={styles.createLayout}>
        <form
          className={styles.dialogForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            onCreate(name.trim(), description.trim() || undefined);
          }}
        >
          <Input
            label="Playlist name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Friday Night Stream"
            autoFocus
          />
          <Input
            label="Description (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Community night board"
          />
          {error && <p className={styles.errorBanner}>{error}</p>}
          <Button type="submit" size="lg" loading={pending} disabled={!name.trim()} fullWidth>
            Create playlist
          </Button>
        </form>

        <div className={styles.previewColumn}>
          <p className={styles.previewLabel}>Preview</p>
          <div className={styles.previewCard}>
            <div className={styles.playlistCardTop}>
              <span className={styles.playlistName}>{name.trim() || "Untitled playlist"}</span>
              <ReadinessBadge readiness={{ status: "empty" }} size="sm" />
            </div>
            <p className={styles.playlistMeta}>0 categories · 0 questions</p>
            {description.trim() && <p className={styles.playlistDescription}>{description.trim()}</p>}
            <p className={styles.playlistUpdated}>Updated just now</p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
