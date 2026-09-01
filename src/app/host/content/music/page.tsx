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

const GAME_KEY = "music" as const;

/**
 * Guess the Music's playlist library — the Music counterpart to
 * ../geoguessr/page.tsx / ../drawing/page.tsx / ../jeopardy/page.tsx.
 * Reads `content.musicPlaylist.*` (contentMusicRouter.ts). A separate
 * component, not a gameKey branch inside any other page — same "don't
 * touch the other games' own files" posture every other Content Studio
 * page in this app already follows. No thumbnail strip on each card —
 * same reasoning as Drawing's own library page: a track's audio clip has
 * no visual thumbnail the way a GeoGuessr round's map does.
 *
 * Creation flow mirrors Jeopardy's own CreatePlaylistDialog (name +
 * optional description, entered up front) rather than the old
 * instant-create-with-default-name pattern.
 */
export default function MusicContentPage() {
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const utils = trpc.useUtils();
  const router = useRouter();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  const playlists = trpc.content.musicPlaylist.list.useQuery({ token, gameKey: GAME_KEY }, { enabled: Boolean(token) });
  const createPlaylist = trpc.content.musicPlaylist.create.useMutation({
    onSuccess: (playlist) => {
      void utils.content.musicPlaylist.list.invalidate();
      router.push(`/host/content/music/playlists/${playlist.id}`);
    },
  });
  const duplicatePlaylist = trpc.content.musicPlaylist.duplicate.useMutation({
    onSuccess: () => void utils.content.musicPlaylist.list.invalidate(),
  });
  const renamePlaylist = trpc.content.musicPlaylist.update.useMutation({
    onSuccess: () => {
      void utils.content.musicPlaylist.list.invalidate();
      setRenamingId(null);
    },
  });
  const deletePlaylist = trpc.content.musicPlaylist.delete.useMutation({
    onSuccess: () => void utils.content.musicPlaylist.list.invalidate(),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const pendingDeletePlaylist = playlists.data?.find((p) => p.id === pendingDeleteId) ?? null;
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function commitRename(playlistId: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    renamePlaylist.mutate({ token, playlistId, name: trimmed });
  }

  return (
    <>
      <StudioBreadcrumb crumbs={[{ label: "Content Studio", href: "/host/content" }, { label: "Guess the Music" }]} />

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Guess the Music</h1>
          <p className={styles.subtitle}>Upload the clips your teams will race to name.</p>
        </div>
        <Button size="lg" onClick={() => setCreateOpen(true)}>
          + Create Playlist
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
          <p>Check your connection and try again.</p>
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
          <h2 className={styles.emptyTitle}>Build your first Guess the Music show.</h2>
          <p className={styles.emptySubtitle}>Upload clips, name them, and you&apos;re ready to play.</p>
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            + Create Playlist
          </Button>
        </motion.div>
      )}

      {playlists.data && playlists.data.length > 0 && (
        <motion.div className={styles.grid} variants={staggerContainer(reduced)} initial="hidden" animate="show">
          <AnimatePresence initial={false}>
            {playlists.data.map((playlist) => {
              const renaming = renamingId === playlist.id;
              return (
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
                    {renaming ? (
                      <input
                        className={styles.renameInput}
                        value={renameValue}
                        autoFocus
                        onChange={(event) => setRenameValue(event.target.value)}
                        onBlur={() => commitRename(playlist.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") setRenamingId(null);
                        }}
                        aria-label="Rename playlist"
                      />
                    ) : (
                      <Link href={`/host/content/music/playlists/${playlist.id}`} className={styles.playlistName}>
                        {playlist.name}
                      </Link>
                    )}
                    <ReadinessBadge readiness={playlist.readiness} size="sm" />
                  </div>

                  <p className={styles.playlistMeta}>
                    {playlist.readiness.status === "incomplete"
                      ? `${playlist.readiness.completeTrackCount} / ${playlist.readiness.trackCount} ready`
                      : `${playlist.trackCount} track${playlist.trackCount === 1 ? "" : "s"}`}
                  </p>
                  {playlist.readiness.status === "incomplete" && (
                    <div className={styles.cardProgressTrack} aria-hidden="true">
                      <div className={styles.cardProgressFill} style={{ width: `${(playlist.readiness.completeTrackCount / playlist.readiness.trackCount) * 100}%` }} />
                    </div>
                  )}
                  {playlist.description && <p className={styles.playlistDescription}>{playlist.description}</p>}
                  {!playlist.readiness.ready && playlist.readiness.status !== "empty" && (
                    <Link href={`/host/content/music/playlists/${playlist.id}`} className={styles.reviewLink}>
                      Review missing content →
                    </Link>
                  )}

                  <div className={styles.playlistFooter}>
                    <p className={styles.playlistUpdated}>Updated {formatRelativeTime(playlist.updatedAt)}</p>
                    <div className={styles.playlistActions}>
                      <Link href={`/host/content/music/playlists/${playlist.id}`}>
                        <Button variant="secondary" size="sm">
                          Edit
                        </Button>
                      </Link>
                      <ActionsMenu
                        items={[
                          { label: "Duplicate", onSelect: () => duplicatePlaylist.mutate({ token, playlistId: playlist.id }) },
                          {
                            label: "Rename",
                            onSelect: () => {
                              setRenameValue(playlist.name);
                              setRenamingId(playlist.id);
                            },
                          },
                          { label: "Delete", danger: true, onSelect: () => setPendingDeleteId(playlist.id) },
                        ]}
                        label={`More actions for ${playlist.name}`}
                      />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          <button type="button" className={styles.createCard} onClick={() => setCreateOpen(true)}>
            <span className={styles.createCardPlus} aria-hidden="true">
              +
            </span>
            Create Playlist
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
            ? `"${pendingDeletePlaylist.name}" and its ${pendingDeletePlaylist.trackCount} track${pendingDeletePlaylist.trackCount === 1 ? "" : "s"} will be permanently removed.`
            : "This will permanently remove this playlist and its tracks."
        }
        confirmLabel="Delete playlist"
        danger
        confirming={deletePlaylist.isPending}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (!pendingDeleteId) return;
          deletePlaylist.mutate({ token, playlistId: pendingDeleteId }, { onSuccess: () => setPendingDeleteId(null) });
        }}
      >
        {deletePlaylist.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this playlist. Please try again.</p>}
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
    <Dialog open={open} onClose={handleClose} title="Create playlist" description="A new playlist, ready to fill in." size="lg">
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
            placeholder="e.g. 90s One-Hit Wonders"
            autoFocus
          />
          <Input
            label="Description (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Community night playlist"
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
              <span className={styles.playlistName}>{name.trim() || "Untitled Playlist"}</span>
              <ReadinessBadge readiness={{ status: "empty" }} size="sm" />
            </div>
            <p className={styles.playlistMeta}>0 tracks</p>
            {description.trim() && <p className={styles.playlistDescription}>{description.trim()}</p>}
            <p className={styles.playlistUpdated}>Updated just now</p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
