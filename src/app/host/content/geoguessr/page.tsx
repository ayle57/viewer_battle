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

const GAME_KEY = "geoguessr" as const;

/**
 * GeoGuessr's playlist library — item 1's "map library / show
 * preparation room," the geo counterpart to ../jeopardy/page.tsx. Reads
 * `content.geoPlaylist.*` (contentGeoRouter.ts) instead of
 * `content.playlist.*`. A separate component, not a gameKey branch
 * inside the Jeopardy page — this pass's instruction is explicit: don't
 * touch Jeopardy's own procedures/UI.
 *
 * Creation flow mirrors Jeopardy's own CreatePlaylistDialog (name +
 * optional description, entered up front) rather than the old
 * instant-create-with-default-name pattern.
 */
export default function GeoGuessrContentPage() {
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const utils = trpc.useUtils();
  const router = useRouter();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  const playlists = trpc.content.geoPlaylist.list.useQuery({ token, gameKey: GAME_KEY }, { enabled: Boolean(token) });
  const createPlaylist = trpc.content.geoPlaylist.create.useMutation({
    onSuccess: (playlist) => {
      void utils.content.geoPlaylist.list.invalidate();
      router.push(`/host/content/geoguessr/playlists/${playlist.id}`);
    },
  });
  const duplicatePlaylist = trpc.content.geoPlaylist.duplicate.useMutation({
    onSuccess: () => void utils.content.geoPlaylist.list.invalidate(),
  });
  const renamePlaylist = trpc.content.geoPlaylist.update.useMutation({
    onSuccess: () => {
      void utils.content.geoPlaylist.list.invalidate();
      setRenamingId(null);
    },
  });
  const deletePlaylist = trpc.content.geoPlaylist.delete.useMutation({
    onSuccess: () => void utils.content.geoPlaylist.list.invalidate(),
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
      <StudioBreadcrumb crumbs={[{ label: "Content Studio", href: "/host/content" }, { label: "GeoGuessr" }]} />

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>GeoGuessr</h1>
          <p className={styles.subtitle}>Prepare the maps and rounds for your next show.</p>
        </div>
        <Button size="lg" onClick={() => setCreateOpen(true)}>
          + Create Map Set
        </Button>
      </div>

      {playlists.data && playlists.data.length > 0 && <p className={styles.sectionLabel}>Your Map Sets</p>}

      {playlists.isLoading && (
        <div className={styles.loadingGrid} aria-busy="true" aria-live="polite">
          <span className={styles.loadingCard} />
          <span className={styles.loadingCard} />
          <span className={styles.loadingCard} />
        </div>
      )}

      {playlists.isError && (
        <div className={styles.errorState}>
          <p className={styles.emptyTitle}>Couldn&apos;t load your map sets.</p>
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
          <p className={styles.emptyEyebrow}>First map set</p>
          <h2 className={styles.emptyTitle}>Build your first GeoGuessr show.</h2>
          <p className={styles.emptySubtitle}>Add maps, mark the correct locations, and you&apos;re ready to play.</p>
          <Button size="lg" onClick={() => setCreateOpen(true)}>
            + Create Map Set
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
                  {/* A glance-able stack of this set's own maps — the whole
                      point of a "library," not just a name in a list. Falls
                      back to the neutral motif once ANY map exists but
                      fewer than 3 do, and to the plain empty-frame look
                      pre-image, rather than stretching one thumbnail to
                      fill three slots (which would misrepresent how many
                      maps are actually in here). */}
                  <div className={styles.thumbStack} aria-hidden="true">
                    {playlist.thumbnails.length > 0 ? (
                      playlist.thumbnails.map((url, i) => (
                        // eslint-disable-next-line @next/next/no-img-element -- small library-card preview, same deliberate plain-<img> choice as ClickableImageMap
                        <img key={url + i} src={url} alt="" className={styles.thumbImage} loading="lazy" />
                      ))
                    ) : (
                      <span className={styles.thumbEmpty}>No maps yet</span>
                    )}
                  </div>

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
                        aria-label="Rename map set"
                      />
                    ) : (
                      <Link href={`/host/content/geoguessr/playlists/${playlist.id}`} className={styles.playlistName}>
                        {playlist.name}
                      </Link>
                    )}
                    <ReadinessBadge readiness={playlist.readiness} size="sm" />
                  </div>

                  <p className={styles.playlistMeta}>
                    {playlist.readiness.status === "incomplete"
                      ? `${playlist.readiness.completeRoundCount} / ${playlist.readiness.roundCount} ready`
                      : `${playlist.roundCount} round${playlist.roundCount === 1 ? "" : "s"}`}
                  </p>
                  {/* Only for a genuinely PARTWAY set — an empty one has
                      nothing to show progress toward yet, and a ready one
                      is already fully said by the badge above; a bar on
                      every card would just be noise on the two cases that
                      don't need it. */}
                  {playlist.readiness.status === "incomplete" && (
                    <div className={styles.cardProgressTrack} aria-hidden="true">
                      <div className={styles.cardProgressFill} style={{ width: `${(playlist.readiness.completeRoundCount / playlist.readiness.roundCount) * 100}%` }} />
                    </div>
                  )}
                  {playlist.description && <p className={styles.playlistDescription}>{playlist.description}</p>}
                  {!playlist.readiness.ready && playlist.readiness.status !== "empty" && (
                    <Link href={`/host/content/geoguessr/playlists/${playlist.id}`} className={styles.reviewLink}>
                      Review missing content →
                    </Link>
                  )}

                  <div className={styles.playlistFooter}>
                    <p className={styles.playlistUpdated}>Updated {formatRelativeTime(playlist.updatedAt)}</p>
                    <div className={styles.playlistActions}>
                      <Link href={`/host/content/geoguessr/playlists/${playlist.id}`}>
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
            Create Map Set
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
        title="Delete this map set?"
        description={
          pendingDeletePlaylist
            ? `"${pendingDeletePlaylist.name}" and its ${pendingDeletePlaylist.roundCount} round${pendingDeletePlaylist.roundCount === 1 ? "" : "s"} will be permanently removed.`
            : "This will permanently remove this map set and its rounds."
        }
        confirmLabel="Delete map set"
        danger
        confirming={deletePlaylist.isPending}
        onCancel={() => setPendingDeleteId(null)}
        onConfirm={() => {
          if (!pendingDeleteId) return;
          deletePlaylist.mutate({ token, playlistId: pendingDeleteId }, { onSuccess: () => setPendingDeleteId(null) });
        }}
      >
        {deletePlaylist.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this map set. Please try again.</p>}
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
    <Dialog open={open} onClose={handleClose} title="Create Map Set" description="A new map set, ready to fill in." size="lg">
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
            label="Map set name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. World Capitals"
            autoFocus
          />
          <Input
            label="Description (optional)"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="e.g. Community night map set"
          />
          {error && <p className={styles.errorBanner}>{error}</p>}
          <Button type="submit" size="lg" loading={pending} disabled={!name.trim()} fullWidth>
            Create Map Set
          </Button>
        </form>

        <div className={styles.previewColumn}>
          <p className={styles.previewLabel}>Preview</p>
          <div className={styles.previewCard}>
            <div className={styles.playlistCardTop}>
              <span className={styles.playlistName}>{name.trim() || "Untitled Map Set"}</span>
              <ReadinessBadge readiness={{ status: "empty" }} size="sm" />
            </div>
            <p className={styles.playlistMeta}>0 rounds</p>
            {description.trim() && <p className={styles.playlistDescription}>{description.trim()}</p>}
            <p className={styles.playlistUpdated}>Updated just now</p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
