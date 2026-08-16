"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, ConfirmDialog } from "@/ui";
import { EASE_OUT_EXPO } from "@/app/_shared/motion/variants";
import { useContentIdentityStore } from "../../../_shared/contentIdentityStore";
import { StudioBreadcrumb } from "../../../_shared/StudioBreadcrumb";
import { ActionsMenu } from "../../../_shared/ActionsMenu";
import { SaveStatus, type SaveState } from "../../../_shared/SaveStatus";
import { ReadinessLine } from "../../../_shared/ReadinessBadge";
import { BoardEditor } from "./BoardEditor";
import { QuestionEditorDialog, type QuestionEditorMode } from "./QuestionEditorDialog";
import styles from "./page.module.css";

export default function PlaylistEditorPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const router = useRouter();
  const searchParams = useSearchParams();
  const utils = trpc.useUtils();
  const reduced = useReducedMotion() ?? false;

  const playlist = trpc.content.playlist.get.useQuery({ token, playlistId }, { enabled: Boolean(token && playlistId), retry: false });
  const updatePlaylist = trpc.content.playlist.update.useMutation({
    onSuccess: () => void utils.content.playlist.get.invalidate({ token, playlistId }),
  });
  const duplicatePlaylist = trpc.content.playlist.duplicate.useMutation({
    onSuccess: (copy) => {
      void utils.content.playlist.list.invalidate();
      // `?duplicated=1` is the one-shot signal the new page reads below to
      // show "Playlist duplicated" — a real acknowledgment (product brief
      // section 7), not a system toast, and not lost across the
      // navigation the way a purely in-memory flag would be.
      router.push(`/host/content/jeopardy/playlists/${copy.id}?duplicated=1`);
    },
  });
  const deletePlaylist = trpc.content.playlist.delete.useMutation({
    onSuccess: () => {
      void utils.content.playlist.list.invalidate();
      router.push("/host/content/jeopardy");
    },
  });

  const [editorMode, setEditorMode] = useState<QuestionEditorMode | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  // The one-shot `?duplicated=1` signal — read via useState's LAZY
  // initializer (evaluated exactly once, at mount, from whatever the URL
  // was when this page first rendered), not derived fresh from
  // `searchParams` on every render: stripping the param below (a real
  // effect, since navigation is a genuine external side effect) would
  // otherwise flip a plain derived boolean back to false the instant the
  // URL updates, flashing the banner and immediately hiding it again.
  const [showDuplicatedBanner, setShowDuplicatedBanner] = useState(() => searchParams.get("duplicated") === "1");
  useEffect(() => {
    if (searchParams.get("duplicated") === "1") {
      router.replace(`/host/content/jeopardy/playlists/${playlistId}`, { scroll: false });
    }
    // Intentionally once-per-mount: this cleans up the URL exactly at the
    // moment this playlist page is navigated to from a duplicate action,
    // not on every searchParams identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Render-phase reset (React's blessed "adjusting state when a prop
  // changes" pattern), not an effect+setState — resets the local edit
  // buffers whenever a DIFFERENT playlist loads (including the very
  // first load), without clobbering in-progress typing on every
  // background refetch of the SAME playlist. See BoardEditor.tsx's
  // CategoryNameField for the identical reasoning.
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
        <Link href="/host/content/jeopardy">
          <Button>← Back to Jeopardy</Button>
        </Link>
      </div>
    );
  }

  // A real loading state, not a blank page (product brief section 13).
  if (!playlist.data) {
    return (
      <div className={styles.loadingState} aria-busy="true" aria-live="polite">
        <span className={styles.loadingLine} />
        <span className={styles.loadingBoard} />
      </div>
    );
  }
  const detail = playlist.data;

  function commitName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === detail.name) {
      setName(detail.name);
      return;
    }
    setSaveState("saving");
    updatePlaylist.mutate(
      { token, playlistId, name: trimmed },
      { onSuccess: () => setSaveState("saved"), onError: () => setSaveState("error") },
    );
  }

  function commitDescription() {
    const trimmed = description.trim();
    if (trimmed === (detail.description ?? "")) return;
    setSaveState("saving");
    updatePlaylist.mutate(
      { token, playlistId, description: trimmed || null },
      { onSuccess: () => setSaveState("saved"), onError: () => setSaveState("error") },
    );
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
          { label: "Jeopardy", href: "/host/content/jeopardy" },
          { label: detail.name },
        ]}
      />

      {showDuplicatedBanner && (
        <motion.div
          className={styles.duplicatedBanner}
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduced ? 0.1 : 0.25, ease: EASE_OUT_EXPO }}
        >
          <span>
            <strong>Playlist duplicated.</strong> This is an independent copy — editing it never touches the original.
          </span>
          <button type="button" className={styles.dismissButton} onClick={() => setShowDuplicatedBanner(false)} aria-label="Dismiss">
            ×
          </button>
        </motion.div>
      )}

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
              <SaveStatus state={saveState} />
            </div>
            <ReadinessLine readiness={detail.readiness} />
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
          <motion.div
            className={styles.inUseBanner}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: reduced ? 0.1 : 0.3, ease: EASE_OUT_EXPO }}
          >
            <Badge variant="warning" dot>
              IN USE
            </Badge>
            <span className={styles.inUseText}>
              <strong>Currently being used by a live game.</strong>
              <span>Changes made here will apply to future games — the game in progress keeps its own snapshot.</span>
            </span>
          </motion.div>
        )}
      </div>

      {detail.categories.length === 0 ? (
        <div className={styles.emptyBoard}>
          <p className={styles.emptyTitle}>Empty board</p>
          <p>Add a category to start building your board.</p>
          <AddFirstCategoryButton token={token} playlistId={playlistId} />
        </div>
      ) : (
        <BoardEditor
          token={token}
          detail={detail}
          onSelectQuestion={(questionId) => setEditorMode({ type: "edit", questionId })}
          onCreateQuestion={(categoryId) => setEditorMode({ type: "create", categoryId })}
        />
      )}

      {editorMode && (
        <QuestionEditorDialog
          token={token}
          detail={detail}
          mode={editorMode}
          onClose={() => setEditorMode(null)}
          onNavigate={setEditorMode}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this playlist?"
        description="This will permanently remove this playlist and its questions."
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

function AddFirstCategoryButton({ token, playlistId }: { token: string; playlistId: string }) {
  const utils = trpc.useUtils();
  const createCategory = trpc.content.category.create.useMutation({
    onSuccess: () => void utils.content.playlist.get.invalidate({ token, playlistId }),
  });
  return (
    <Button loading={createCategory.isPending} onClick={() => createCategory.mutate({ token, playlistId, name: "New Category" })}>
      + Add category
    </Button>
  );
}
