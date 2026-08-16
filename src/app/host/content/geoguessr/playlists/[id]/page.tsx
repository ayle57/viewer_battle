"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { trpc } from "@/app/_trpc/client";
import { isRoundComplete } from "@/domain/content";
import { Badge, Button, ConfirmDialog } from "@/ui";
import { EASE_OUT_EXPO } from "@/app/_shared/motion/variants";
import { useContentIdentityStore } from "../../../_shared/contentIdentityStore";
import { StudioBreadcrumb } from "../../../_shared/StudioBreadcrumb";
import { ActionsMenu } from "../../../_shared/ActionsMenu";
import { GeoReadinessLine } from "../../../_shared/GeoReadinessBadge";
import { RoundEditorDialog } from "./RoundEditorDialog";
import styles from "./page.module.css";

/**
 * GeoGuessr's playlist editor — the geo counterpart to
 * ../../jeopardy/playlists/[id]/page.tsx (round grid instead of a
 * category/question board, RoundEditorDialog instead of
 * QuestionEditorDialog + BoardEditor), same header/breadcrumb/save
 * conventions. A separate page, not a gameKey branch inside Jeopardy's —
 * this pass's instruction is explicit: don't touch Jeopardy's own files.
 */
export default function GeoPlaylistEditorPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const router = useRouter();
  const utils = trpc.useUtils();
  const reduced = useReducedMotion() ?? false;

  const playlist = trpc.content.geoPlaylist.get.useQuery({ token, playlistId }, { enabled: Boolean(token && playlistId), retry: false });
  const invalidate = () => utils.content.geoPlaylist.get.invalidate({ token, playlistId });

  const updatePlaylist = trpc.content.geoPlaylist.update.useMutation({ onSuccess: () => void invalidate() });
  const duplicatePlaylist = trpc.content.geoPlaylist.duplicate.useMutation({
    onSuccess: (copy) => {
      void utils.content.geoPlaylist.list.invalidate();
      router.push(`/host/content/geoguessr/playlists/${copy.id}`);
    },
  });
  const deletePlaylist = trpc.content.geoPlaylist.delete.useMutation({
    onSuccess: () => {
      void utils.content.geoPlaylist.list.invalidate();
      router.push("/host/content/geoguessr");
    },
  });
  const createRound = trpc.content.geoRound.create.useMutation({ onSuccess: () => void invalidate() });
  const deleteRound = trpc.content.geoRound.delete.useMutation({ onSuccess: () => void invalidate() });
  const reorderRounds = trpc.content.geoRound.reorder.useMutation({ onSuccess: () => void invalidate() });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editingRoundId, setEditingRoundId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // Render-phase reset — same pattern/reasoning as Jeopardy's
  // syncedPlaylistId (page.tsx), not an effect+setState.
  const [syncedPlaylistId, setSyncedPlaylistId] = useState<string | undefined>(undefined);
  if (playlist.data && playlist.data.id !== syncedPlaylistId) {
    setSyncedPlaylistId(playlist.data.id);
    setName(playlist.data.name);
    setDescription(playlist.data.description ?? "");
  }

  if (playlist.isError) {
    return (
      <div className={styles.emptyBoard}>
        <p className={styles.emptyTitle}>Playlist not found.</p>
        <p>It may have been deleted, or it belongs to a different Content Studio identity.</p>
        <Link href="/host/content/geoguessr">
          <Button>← Back to GeoGuessr</Button>
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
  const editingRound = detail.rounds.find((r) => r.id === editingRoundId) ?? null;

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

  function moveRound(roundId: string, direction: -1 | 1) {
    const ids = detail.rounds.map((r) => r.id);
    const index = ids.indexOf(roundId);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderRounds.mutate({ token, playlistId, orderedRoundIds: ids });
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
          { label: "GeoGuessr", href: "/host/content/geoguessr" },
          { label: detail.name },
        ]}
      />

      <div className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.titleBlock}>
            <input
              className={styles.nameInput}
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              aria-label="Playlist name"
            />
            <div className={styles.subLine}>
              <input
                className={styles.descriptionInput}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                onBlur={commitDescription}
                onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
                placeholder="Add a description…"
                aria-label="Playlist description"
              />
            </div>
            <div className={styles.readinessRow}>
              <GeoReadinessLine readiness={detail.readiness} />
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

      {detail.rounds.length === 0 ? (
        <div className={styles.emptyBoard}>
          <p className={styles.emptyTitle}>No rounds yet</p>
          <p>Add a round — an image and a target — to start building this playlist.</p>
          <Button loading={createRound.isPending} onClick={() => createRound.mutate({ token, playlistId })}>
            + Add round
          </Button>
        </div>
      ) : (
        <div className={styles.roundGrid}>
          {detail.rounds.map((round, index) => {
            const complete = isRoundComplete(round);
            return (
              <div key={round.id} className={styles.roundCard}>
                <div className={styles.roundCardTop}>
                  <p className={styles.roundNumber}>ROUND {index + 1}</p>
                  <div className={styles.roundOrderButtons}>
                    <button type="button" className={styles.roundOrderButton} disabled={index === 0} onClick={() => moveRound(round.id, -1)} aria-label="Move up">
                      ↑
                    </button>
                    <button
                      type="button"
                      className={styles.roundOrderButton}
                      disabled={index === detail.rounds.length - 1}
                      onClick={() => moveRound(round.id, 1)}
                      aria-label="Move down"
                    >
                      ↓
                    </button>
                  </div>
                </div>

                <button type="button" className={styles.roundThumb} onClick={() => setEditingRoundId(round.id)}>
                  {round.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- see ClickableImageMap's doc comment
                    <img src={round.imageUrl} alt={round.title ?? `Round ${index + 1}`} className={styles.roundThumbImage} loading="lazy" />
                  ) : (
                    <span className={styles.roundThumbEmpty}>No image</span>
                  )}
                </button>

                <p className={styles.roundTitle}>{round.title || `Round ${index + 1}`}</p>

                <div className={styles.roundStatusRow}>
                  <Badge variant={complete ? "success" : "warning"} dot size="sm">
                    {complete ? "✓ Set" : "⚠ Not configured"}
                  </Badge>
                  <div className={styles.roundActions}>
                    <Button variant="secondary" size="sm" onClick={() => setEditingRoundId(round.id)}>
                      Edit
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteRound.mutate({ token, roundId: round.id })}>
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}

          <button type="button" className={styles.addRoundCard} onClick={() => createRound.mutate({ token, playlistId })}>
            <span className={styles.addRoundPlus} aria-hidden="true">
              +
            </span>
            New round
          </button>
        </div>
      )}

      {editingRound && <RoundEditorDialog token={token} playlistId={playlistId} round={editingRound} onClose={() => setEditingRoundId(null)} />}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this playlist?"
        description="This will permanently remove this playlist and its rounds."
        confirmLabel="Delete playlist"
        danger
        confirming={deletePlaylist.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deletePlaylist.mutate({ token, playlistId })}
      >
        {deletePlaylist.isError && <p className={styles.errorBanner}>{deletePlaylist.error.message}</p>}
      </ConfirmDialog>
    </motion.div>
  );
}
