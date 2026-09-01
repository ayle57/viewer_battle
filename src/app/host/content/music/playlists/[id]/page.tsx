"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, ConfirmDialog } from "@/ui";
import { EASE_OUT_EXPO, fadeUp } from "@/app/_shared/motion/variants";
import { useContentIdentityStore } from "../../../_shared/contentIdentityStore";
import { StudioBreadcrumb } from "../../../_shared/StudioBreadcrumb";
import { ActionsMenu } from "@/app/_shared/ActionsMenu";
import { ReadinessBadge } from "../../../_shared/ReadinessBadge";
import { TrackEditorPanel } from "./TrackEditorPanel";
import styles from "./page.module.css";

/**
 * Music's playlist editor — the same "persistent track SIDEBAR next to a
 * single MAIN editor panel" shape as ../../geoguessr/playlists/[id]/
 * page.tsx, adapted for a flat track list (audio + title + optional
 * artist, no image/target/question). A separate page from GeoGuessr's/
 * Jeopardy's own, same reasoning as every other game's own editor: don't
 * touch another game's files.
 */
export default function MusicPlaylistEditorPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const searchParams = useSearchParams();
  const isFreshlyCreated = searchParams.get("new") === "1"; // set by the library's "+ Create Playlist" — drives the name field's autofocus below
  const isDuplicated = searchParams.get("duplicated") === "1"; // set by duplicatePlaylist's own onSuccess redirect below — drives the transient confirmation banner
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const router = useRouter();
  const utils = trpc.useUtils();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  const playlist = trpc.content.musicPlaylist.get.useQuery({ token, playlistId }, { enabled: Boolean(token && playlistId), retry: false });
  const invalidate = () => utils.content.musicPlaylist.get.invalidate({ token, playlistId });

  const updatePlaylist = trpc.content.musicPlaylist.update.useMutation({ onSuccess: () => void invalidate() });
  const duplicatePlaylist = trpc.content.musicPlaylist.duplicate.useMutation({
    onSuccess: (copy) => {
      void utils.content.musicPlaylist.list.invalidate();
      router.push(`/host/content/music/playlists/${copy.id}?duplicated=1`);
    },
  });
  const deletePlaylist = trpc.content.musicPlaylist.delete.useMutation({
    onSuccess: () => {
      void utils.content.musicPlaylist.list.invalidate();
      router.push("/host/content/music");
    },
  });
  // `createTrack`/`duplicateTrack` deliberately RETURN `invalidate()`'s
  // promise, not `void`-discard it — same fix as GeoGuessr's own
  // createRound/duplicateRound (see that file's own doc comment for the
  // real, reproduced race this closes: a per-call `onSuccess` selecting
  // the new row could otherwise fire before the cache actually held it).
  const createTrack = trpc.content.musicTrack.create.useMutation({ onSuccess: () => invalidate() });
  const duplicateTrack = trpc.content.musicTrack.duplicate.useMutation({ onSuccess: () => invalidate() });
  const deleteTrack = trpc.content.musicTrack.delete.useMutation({ onSuccess: () => void invalidate() });
  const reorderTracks = trpc.content.musicTrack.reorder.useMutation({ onSuccess: () => void invalidate() });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDeleteTrackId, setPendingDeleteTrackId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showDuplicatedBanner, setShowDuplicatedBanner] = useState(isDuplicated);

  // Same "own panel reports dirty, this page owns every switch action"
  // contract as GeoGuessr's own editor page — see TrackEditorPanel's own
  // doc comment.
  const [dirty, setDirty] = useState(false);
  const [pendingSwitchAction, setPendingSwitchAction] = useState<(() => void) | null>(null);

  function guardedSwitch(action: () => void) {
    if (dirty) {
      setPendingSwitchAction(() => action);
    } else {
      action();
    }
  }

  useEffect(() => {
    if (!showDuplicatedBanner) return;
    const timeout = setTimeout(() => setShowDuplicatedBanner(false), 4000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once on mount
  }, []);

  // Render-phase reset — same pattern as GeoGuessr's own syncedPlaylistId.
  const [syncedPlaylistId, setSyncedPlaylistId] = useState<string | undefined>(undefined);
  if (playlist.data && playlist.data.id !== syncedPlaylistId) {
    setSyncedPlaylistId(playlist.data.id);
    setName(playlist.data.name);
    setDescription(playlist.data.description ?? "");
    setSelectedTrackId(playlist.data.tracks[0]?.id ?? null);
  }
  // A track can vanish out from under the current selection (deleted in
  // another tab, or by this tab's own Delete) — fall back to the new
  // first track rather than leaving the main panel pointed at nothing.
  if (playlist.data && selectedTrackId && !playlist.data.tracks.some((t) => t.id === selectedTrackId)) {
    setSelectedTrackId(playlist.data.tracks[0]?.id ?? null);
  }

  if (playlist.isError) {
    return (
      <div className={styles.emptyBoard}>
        <p className={styles.emptyTitle}>Playlist not found.</p>
        <p>It may have been deleted, or it belongs to a different Content Studio identity.</p>
        <Link href="/host/content/music">
          <Button>← Back to Guess the Music</Button>
        </Link>
      </div>
    );
  }

  if (!playlist.data) {
    return (
      <div className={styles.loadingState} aria-busy="true" aria-live="polite">
        <span className={styles.loadingLine} />
        <span className={styles.loadingBoard} />
      </div>
    );
  }
  const detail = playlist.data;
  const selectedIndex = detail.tracks.findIndex((t) => t.id === selectedTrackId);
  const selectedTrack = selectedIndex >= 0 ? detail.tracks[selectedIndex]! : null;
  const pendingDeleteTrack = detail.tracks.find((t) => t.id === pendingDeleteTrackId) ?? null;

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === detail.name) {
      setName(detail.name);
      return;
    }
    updatePlaylist.mutate({ token, playlistId, name: trimmed });
  }

  function commitDescription() {
    const trimmed = description.trim();
    if (trimmed === (detail.description ?? "")) return;
    updatePlaylist.mutate({ token, playlistId, description: trimmed || null });
  }

  function moveTrack(trackId: string, direction: -1 | 1) {
    const ids = detail.tracks.map((t) => t.id);
    const index = ids.indexOf(trackId);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderTracks.mutate({ token, playlistId, orderedTrackIds: ids });
  }

  // "Save & Next Track" — same shape as GeoGuessr's own handleRoundSaved:
  // jump to the track already sitting after this one, or create a fresh
  // one if this was the last.
  function handleTrackSaved(mode: "stay" | "next") {
    if (mode === "stay" || !selectedTrackId) return;
    const ids = detail.tracks.map((t) => t.id);
    const nextId = ids[ids.indexOf(selectedTrackId) + 1];
    if (nextId) {
      setSelectedTrackId(nextId);
      return;
    }
    createTrack.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedTrackId(created.id) });
  }

  function handleAddTrack() {
    guardedSwitch(() => {
      createTrack.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedTrackId(created.id) });
    });
  }

  function handleDuplicateTrack() {
    if (!selectedTrackId) return;
    guardedSwitch(() => {
      duplicateTrack.mutate({ token, trackId: selectedTrackId }, { onSuccess: (created) => setSelectedTrackId(created.id) });
    });
  }

  return (
    <motion.div
      className={styles.pageIn}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0.12 : 0.35, ease: EASE_OUT_EXPO }}
    >
      <StudioBreadcrumb
        crumbs={[
          { label: "Content Studio", href: "/host/content" },
          { label: "Guess the Music", href: "/host/content/music" },
          { label: detail.name },
        ]}
      />

      <div className={styles.header}>
        <AnimatePresence>
          {showDuplicatedBanner && (
            <motion.div className={styles.duplicatedBanner} initial="hidden" animate="show" exit="hidden" variants={fadeUp(reduced, { y: -6, duration: 0.25 })}>
              <span>✓ Playlist duplicated</span>
              <button type="button" className={styles.dismissButton} onClick={() => setShowDuplicatedBanner(false)} aria-label="Dismiss">
                ✕
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        <div className={styles.titleRow}>
          <div className={styles.titleBlock}>
            <div className={styles.nameRow}>
              <input
                className={styles.nameInput}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                aria-label="Playlist name"
                title={name}
                autoFocus={isFreshlyCreated}
                onFocus={(event) => isFreshlyCreated && event.currentTarget.select()}
              />
              <ReadinessBadge readiness={detail.readiness} size="md" />
            </div>
            <div className={styles.subLine}>
              <input
                className={styles.descriptionInput}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={commitDescription}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                placeholder="Add a description…"
                aria-label="Playlist description"
                title={description || undefined}
              />
            </div>
          </div>
          <div className={styles.actions}>
            <ActionsMenu
              items={[
                { label: "Duplicate playlist", onSelect: () => duplicatePlaylist.mutate({ token, playlistId }) },
                { label: "Delete playlist", danger: true, onSelect: () => setDeleteOpen(true) },
              ]}
              label="Playlist actions"
            />
          </div>
        </div>

        {detail.tracks.length > 0 && (
          <div className={styles.statsBlock}>
            <div className={styles.statsRow}>
              <span className={styles.statItem}>
                {detail.readiness.trackCount} TRACK{detail.readiness.trackCount === 1 ? "" : "S"}
              </span>
              <span className={[styles.statItem, styles.statOk].join(" ")}>{detail.readiness.completeTrackCount} READY</span>
              {detail.readiness.incompleteTracks.length > 0 && (
                <span className={[styles.statItem, styles.statWarn].join(" ")}>{detail.readiness.incompleteTracks.length} NEED ATTENTION</span>
              )}
            </div>
            <div className={styles.progressTrack} role="progressbar" aria-valuenow={detail.readiness.completeTrackCount} aria-valuemin={0} aria-valuemax={detail.readiness.trackCount}>
              <div className={styles.progressFill} style={{ width: `${(detail.readiness.completeTrackCount / detail.readiness.trackCount) * 100}%` }} />
            </div>
            <div className={styles.headerCta}>
              {detail.readiness.ready ? (
                <Link href="/host">
                  <Button size="sm">Play →</Button>
                </Link>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => detail.readiness.firstProblemTrackId && setSelectedTrackId(detail.readiness.firstProblemTrackId)}
                >
                  Review missing tracks
                </Button>
              )}
            </div>
          </div>
        )}

        {detail.inUse && (
          <div className={styles.inUseBanner}>
            <Badge variant="warning" dot>
              IN USE
            </Badge>
            <span className={styles.inUseText}>
              <strong>Currently being used by a live game.</strong>
              <span>Changes made here will apply to future games — the game in progress keeps its own snapshot.</span>
            </span>
          </div>
        )}
      </div>

      {detail.tracks.length === 0 ? (
        <div className={styles.emptyBoard}>
          <p className={styles.emptyTitle}>No tracks yet</p>
          <p>Add a track — an audio clip and its title — to start building this show.</p>
          <Button loading={createTrack.isPending} onClick={handleAddTrack}>
            + Add Track
          </Button>
        </div>
      ) : (
        <div className={styles.editorLayout}>
          <nav className={styles.sidebar} aria-label="Tracks">
            <p className={styles.sidebarLabel}>
              {detail.tracks.length} track{detail.tracks.length === 1 ? "" : "s"}
            </p>
            <ol className={styles.roundList}>
              {detail.tracks.map((track, index) => {
                const state = trackSidebarState(track);
                const selected = track.id === selectedTrackId;
                return (
                  <li key={track.id}>
                    <div className={[styles.roundListItem, selected && styles.roundListItemSelected].filter(Boolean).join(" ")}>
                      <button type="button" className={styles.roundListButton} onClick={() => guardedSwitch(() => setSelectedTrackId(track.id))}>
                        <span className={styles.roundListNumber}>{String(index + 1).padStart(2, "0")}</span>
                        <span className={styles.roundListTitle}>{track.title || `Track ${index + 1}`}</span>
                        <span
                          className={state === "ready" ? styles.roundListOk : state === "empty" ? styles.roundListEmpty : styles.roundListWarn}
                          aria-hidden="true"
                        >
                          {state === "ready" ? "✓" : state === "empty" ? "—" : "⚠"}
                        </span>
                      </button>
                      <div className={styles.roundListOrderButtons}>
                        <button
                          type="button"
                          className={styles.roundOrderButton}
                          disabled={index === 0}
                          onClick={() => moveTrack(track.id, -1)}
                          aria-label={`Move track ${index + 1} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.roundOrderButton}
                          disabled={index === detail.tracks.length - 1}
                          onClick={() => moveTrack(track.id, 1)}
                          aria-label={`Move track ${index + 1} down`}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <Button variant="secondary" size="sm" fullWidth loading={createTrack.isPending} onClick={handleAddTrack}>
              + Add Track
            </Button>
          </nav>

          <div className={styles.main}>
            {selectedTrack && (
              // `key={selectedTrack.id}` remounts the whole subtree on a
              // track switch — same reasoning as GeoGuessr's own editor
              // (resets TrackEditorPanel's local buffer, see that
              // component's own doc comment).
              <motion.div key={selectedTrack.id} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 10, duration: 0.3 })}>
                <TrackEditorPanel
                  token={token}
                  playlistId={playlistId}
                  track={selectedTrack}
                  trackNumber={selectedIndex + 1}
                  hasNextTrack={selectedIndex < detail.tracks.length - 1}
                  onSaved={handleTrackSaved}
                  onDuplicate={handleDuplicateTrack}
                  duplicating={duplicateTrack.isPending}
                  onRequestDelete={() => setPendingDeleteTrackId(selectedTrack.id)}
                  onDirtyChange={setDirty}
                />
              </motion.div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteTrackId !== null}
        title="Delete this track?"
        description={pendingDeleteTrack ? `"${pendingDeleteTrack.title || "This track"}" will be permanently removed from this playlist.` : undefined}
        confirmLabel="Delete track"
        danger
        confirming={deleteTrack.isPending}
        onCancel={() => setPendingDeleteTrackId(null)}
        onConfirm={() => {
          if (!pendingDeleteTrackId) return;
          deleteTrack.mutate({ token, trackId: pendingDeleteTrackId }, { onSuccess: () => setPendingDeleteTrackId(null) });
        }}
      >
        {deleteTrack.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this track. Please try again.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingSwitchAction !== null}
        title="Discard unsaved changes?"
        description="This track has edits that haven't been saved yet. Switching now will lose them."
        confirmLabel="Discard changes"
        danger
        onCancel={() => setPendingSwitchAction(null)}
        onConfirm={() => {
          const action = pendingSwitchAction;
          setPendingSwitchAction(null);
          action?.();
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this playlist?"
        description="This will permanently remove this playlist and its tracks."
        confirmLabel="Delete playlist"
        danger
        confirming={deletePlaylist.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deletePlaylist.mutate({ token, playlistId })}
      >
        {deletePlaylist.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this playlist. Please try again.</p>}
      </ConfirmDialog>
    </motion.div>
  );
}

/**
 * A three-way read of the SAME fields `isTrackComplete`/
 * `getMusicPlaylistReadiness` already check (src/domain/content) — same
 * "empty vs. incomplete vs. ready" distinction GeoGuessr's own
 * roundSidebarState makes.
 */
function trackSidebarState(track: { audioUrl: string | null; title: string | null }): "empty" | "incomplete" | "ready" {
  const hasAudio = Boolean(track.audioUrl);
  const hasTitle = Boolean(track.title);
  if (hasAudio && hasTitle) return "ready";
  if (!hasAudio && !hasTitle) return "empty";
  return "incomplete";
}
