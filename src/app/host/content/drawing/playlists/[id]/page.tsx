"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, ConfirmDialog, Dialog } from "@/ui";
import { EASE_OUT_EXPO, fadeUp } from "@/app/_shared/motion/variants";
import { useContentIdentityStore } from "../../../_shared/contentIdentityStore";
import { StudioBreadcrumb } from "../../../_shared/StudioBreadcrumb";
import { ActionsMenu } from "@/app/_shared/ActionsMenu";
import { ReadinessBadge } from "../../../_shared/ReadinessBadge";
import { PromptEditorPanel, type PromptEditorPanelHandle } from "./PromptEditorPanel";
import styles from "./page.module.css";

/**
 * Drawing's playlist editor — same "persistent sidebar + single main
 * editor panel" shape as ../../geoguessr/playlists/[id]/page.tsx (see
 * that file's own doc comment for the full reasoning), simplified since
 * a Drawing prompt only has two fields (word, duration) — no map/asset
 * concerns, so no Preview pane either. A separate page from the other
 * two games' own editors, not a gameKey branch inside either — same
 * "don't touch the other games' own files" posture as GeoGuessr's own.
 */
export default function DrawingPlaylistEditorPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const searchParams = useSearchParams();
  const isFreshlyCreated = searchParams.get("new") === "1"; // set by the library's "+ Create Prompt List" (page.tsx) — drives the name field's autofocus below
  const isDuplicated = searchParams.get("duplicated") === "1"; // set by duplicatePlaylist's own onSuccess redirect below — drives the transient confirmation banner
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const router = useRouter();
  const utils = trpc.useUtils();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  const playlist = trpc.content.drawingPlaylist.get.useQuery({ token, playlistId }, { enabled: Boolean(token && playlistId), retry: false });
  const invalidate = () => utils.content.drawingPlaylist.get.invalidate({ token, playlistId });

  const updatePlaylist = trpc.content.drawingPlaylist.update.useMutation({ onSuccess: () => void invalidate() });
  const duplicatePlaylist = trpc.content.drawingPlaylist.duplicate.useMutation({
    onSuccess: (copy) => {
      void utils.content.drawingPlaylist.list.invalidate();
      router.push(`/host/content/drawing/playlists/${copy.id}?duplicated=1`);
    },
  });
  const deletePlaylist = trpc.content.drawingPlaylist.delete.useMutation({
    onSuccess: () => {
      void utils.content.drawingPlaylist.list.invalidate();
      router.push("/host/content/drawing");
    },
  });
  // `createPrompt`/`duplicatePrompt` deliberately RETURN `invalidate()`'s
  // promise here, not `void`-discard it — same real, reproduced bug fix
  // as GeoGuessr's own page.tsx (see its identical comment): the
  // per-call `onSuccess: (created) => setSelectedPromptId(created.id)`
  // must only run once the cache genuinely has the new prompt in it.
  const createPrompt = trpc.content.drawingPrompt.create.useMutation({ onSuccess: () => invalidate() });
  const duplicatePrompt = trpc.content.drawingPrompt.duplicate.useMutation({ onSuccess: () => invalidate() });
  const deletePrompt = trpc.content.drawingPrompt.delete.useMutation({ onSuccess: () => void invalidate() });
  const reorderPrompts = trpc.content.drawingPrompt.reorder.useMutation({ onSuccess: () => void invalidate() });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDeletePromptId, setPendingDeletePromptId] = useState<string | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showDuplicatedBanner, setShowDuplicatedBanner] = useState(isDuplicated);

  // Same "warn before discarding an unsaved edit" contract as GeoGuessr's
  // own page.tsx — see that file's identical comment.
  const [dirty, setDirty] = useState(false);
  const [pendingSwitchAction, setPendingSwitchAction] = useState<(() => void) | null>(null);
  // Same imperative-handle + "Save and continue" pair as GeoGuessr's own
  // page.tsx — see that file's identical comments (panelRef,
  // saveAndContinueSwitch) for the full reasoning.
  const panelRef = useRef<PromptEditorPanelHandle>(null);
  const [savingBeforeSwitch, setSavingBeforeSwitch] = useState(false);
  const [saveBeforeSwitchFailed, setSaveBeforeSwitchFailed] = useState(false);

  function guardedSwitch(action: () => void) {
    if (dirty) {
      setSaveBeforeSwitchFailed(false);
      setPendingSwitchAction(() => action);
    } else {
      action();
    }
  }

  async function saveAndContinueSwitch() {
    setSavingBeforeSwitch(true);
    setSaveBeforeSwitchFailed(false);
    const ok = await panelRef.current?.save("stay");
    setSavingBeforeSwitch(false);
    if (!ok) {
      setSaveBeforeSwitchFailed(true);
      return;
    }
    const action = pendingSwitchAction;
    setPendingSwitchAction(null);
    action?.();
  }

  // Keyboard fast-path — same ArrowLeft/ArrowRight navigation as
  // GeoGuessr's own page.tsx (mirroring QuestionEditorDialog's identical
  // pattern), minus the map-focus exclusion: Drawing's editor has no
  // `ClickableImageMap`, so the plain INPUT/TEXTAREA guard is the whole
  // story here.
  const latestPromptNavRef = useRef({ selectedPromptId, prompts: playlist.data?.prompts ?? [], guardedSwitch });
  useEffect(() => {
    latestPromptNavRef.current = { selectedPromptId, prompts: playlist.data?.prompts ?? [], guardedSwitch };
  });
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = document.activeElement;
      const isEditableFocused = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      if (isEditableFocused) return;

      const { selectedPromptId: currentId, prompts, guardedSwitch: guard } = latestPromptNavRef.current;
      const ids = prompts.map((p) => p.id);
      const index = currentId ? ids.indexOf(currentId) : -1;
      if (index === -1) return;
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        guard(() => setSelectedPromptId(ids[index - 1]!));
      } else if (event.key === "ArrowRight" && index < ids.length - 1) {
        event.preventDefault();
        guard(() => setSelectedPromptId(ids[index + 1]!));
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // Deliberately once for the page's whole lifetime — everything this
    // handler needs is read through `latestPromptNavRef`, not closed
    // over directly.
  }, []);

  useEffect(() => {
    if (!showDuplicatedBanner) return;
    const timeout = setTimeout(() => setShowDuplicatedBanner(false), 4000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once on mount
  }, []);

  const [syncedPlaylistId, setSyncedPlaylistId] = useState<string | undefined>(undefined);
  if (playlist.data && playlist.data.id !== syncedPlaylistId) {
    setSyncedPlaylistId(playlist.data.id);
    setName(playlist.data.name);
    setDescription(playlist.data.description ?? "");
    setSelectedPromptId(playlist.data.prompts[0]?.id ?? null);
  }
  if (playlist.data && selectedPromptId && !playlist.data.prompts.some((p) => p.id === selectedPromptId)) {
    setSelectedPromptId(playlist.data.prompts[0]?.id ?? null);
  }

  if (playlist.isError) {
    return (
      <div className={styles.emptyBoard}>
        <p className={styles.emptyTitle}>Playlist not found.</p>
        <p>It may have been deleted, or it belongs to a different Content Studio identity.</p>
        <Link href="/host/content/drawing">
          <Button>← Back to Drawing</Button>
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
  const selectedIndex = detail.prompts.findIndex((p) => p.id === selectedPromptId);
  const selectedPrompt = selectedIndex >= 0 ? detail.prompts[selectedIndex]! : null;
  const pendingDeletePrompt = detail.prompts.find((p) => p.id === pendingDeletePromptId) ?? null;

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

  function movePrompt(promptId: string, direction: -1 | 1) {
    const ids = detail.prompts.map((p) => p.id);
    const index = ids.indexOf(promptId);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderPrompts.mutate({ token, playlistId, orderedPromptIds: ids });
  }

  // "Save & Next Prompt" — same shape as GeoGuessr's own handleRoundSaved.
  function handlePromptSaved(mode: "stay" | "next") {
    if (mode === "stay" || !selectedPromptId) return;
    const ids = detail.prompts.map((p) => p.id);
    const nextId = ids[ids.indexOf(selectedPromptId) + 1];
    if (nextId) {
      setSelectedPromptId(nextId);
      return;
    }
    createPrompt.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedPromptId(created.id) });
  }

  function handleAddPrompt() {
    guardedSwitch(() => {
      createPrompt.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedPromptId(created.id) });
    });
  }

  function handleDuplicatePrompt() {
    if (!selectedPromptId) return;
    guardedSwitch(() => {
      duplicatePrompt.mutate({ token, promptId: selectedPromptId }, { onSuccess: (created) => setSelectedPromptId(created.id) });
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
          { label: "Drawing", href: "/host/content/drawing" },
          { label: detail.name },
        ]}
      />

      <div className={styles.header}>
        <AnimatePresence>
          {showDuplicatedBanner && (
            <motion.div className={styles.duplicatedBanner} initial="hidden" animate="show" exit="hidden" variants={fadeUp(reduced, { y: -6, duration: 0.25 })}>
              <span>✓ Prompt list duplicated</span>
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

        {detail.prompts.length > 0 && (
          <div className={styles.statsBlock}>
            <div className={styles.statsRow}>
              <span className={styles.statItem}>
                {detail.readiness.promptCount} PROMPT{detail.readiness.promptCount === 1 ? "" : "S"}
              </span>
              <span className={[styles.statItem, styles.statOk].join(" ")}>{detail.readiness.completePromptCount} READY</span>
              {detail.readiness.incompletePrompts.length > 0 && (
                <span className={[styles.statItem, styles.statWarn].join(" ")}>{detail.readiness.incompletePrompts.length} NEED ATTENTION</span>
              )}
            </div>
            <div className={styles.progressTrack} role="progressbar" aria-valuenow={detail.readiness.completePromptCount} aria-valuemin={0} aria-valuemax={detail.readiness.promptCount}>
              <div className={styles.progressFill} style={{ width: `${(detail.readiness.completePromptCount / detail.readiness.promptCount) * 100}%` }} />
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
                  onClick={() => detail.readiness.firstProblemPromptId && setSelectedPromptId(detail.readiness.firstProblemPromptId)}
                >
                  Review missing prompts
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

      {detail.prompts.length === 0 ? (
        <div className={styles.emptyBoard}>
          <p className={styles.emptyTitle}>No prompts yet</p>
          <p>Add a prompt — a word to draw, and how long the drawer gets — to start building this show.</p>
          <Button loading={createPrompt.isPending} onClick={handleAddPrompt}>
            + Add Prompt
          </Button>
        </div>
      ) : (
        <div className={styles.editorLayout}>
          <nav className={styles.sidebar} aria-label="Prompts">
            <p className={styles.sidebarLabel}>
              {detail.prompts.length} prompt{detail.prompts.length === 1 ? "" : "s"}
            </p>
            <ol className={styles.roundList}>
              {detail.prompts.map((prompt, index) => {
                const ready = Boolean(prompt.text && prompt.text.trim());
                const selected = prompt.id === selectedPromptId;
                return (
                  <li key={prompt.id}>
                    <div className={[styles.roundListItem, selected && styles.roundListItemSelected].filter(Boolean).join(" ")}>
                      <button type="button" className={styles.roundListButton} onClick={() => guardedSwitch(() => setSelectedPromptId(prompt.id))}>
                        <span className={styles.roundListNumber}>{String(index + 1).padStart(2, "0")}</span>
                        <span className={styles.roundListTitle}>{prompt.text || `Prompt ${index + 1}`}</span>
                        <span className={ready ? styles.roundListOk : styles.roundListEmpty} aria-hidden="true">
                          {ready ? "✓" : "—"}
                        </span>
                      </button>
                      <div className={styles.roundListOrderButtons}>
                        <button
                          type="button"
                          className={styles.roundOrderButton}
                          disabled={index === 0}
                          onClick={() => movePrompt(prompt.id, -1)}
                          aria-label={`Move prompt ${index + 1} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.roundOrderButton}
                          disabled={index === detail.prompts.length - 1}
                          onClick={() => movePrompt(prompt.id, 1)}
                          aria-label={`Move prompt ${index + 1} down`}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <Button variant="secondary" size="sm" fullWidth loading={createPrompt.isPending} onClick={handleAddPrompt}>
              + Add Prompt
            </Button>
          </nav>

          <div className={styles.main}>
            {selectedPrompt && (
              <motion.div key={selectedPrompt.id} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 10, duration: 0.3 })}>
                <PromptEditorPanel
                  ref={panelRef}
                  token={token}
                  playlistId={playlistId}
                  prompt={selectedPrompt}
                  promptNumber={selectedIndex + 1}
                  hasNextPrompt={selectedIndex < detail.prompts.length - 1}
                  onSaved={handlePromptSaved}
                  onDuplicate={handleDuplicatePrompt}
                  duplicating={duplicatePrompt.isPending}
                  onRequestDelete={() => setPendingDeletePromptId(selectedPrompt.id)}
                  onDirtyChange={setDirty}
                />
              </motion.div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeletePromptId !== null}
        title="Delete this prompt?"
        description={pendingDeletePrompt ? `"${pendingDeletePrompt.text || "This prompt"}" will be permanently removed from this playlist.` : undefined}
        confirmLabel="Delete prompt"
        danger
        confirming={deletePrompt.isPending}
        onCancel={() => setPendingDeletePromptId(null)}
        onConfirm={() => {
          if (!pendingDeletePromptId) return;
          deletePrompt.mutate({ token, promptId: pendingDeletePromptId }, { onSuccess: () => setPendingDeletePromptId(null) });
        }}
      >
        {deletePrompt.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this prompt. Please try again.</p>}
      </ConfirmDialog>

      {/* A real `Dialog`, not `ConfirmDialog` — same reasoning as
          GeoGuessr's identical dialog (page.tsx): three real outcomes
          here (Cancel, Discard, Save and continue), not two. */}
      <Dialog
        open={pendingSwitchAction !== null}
        onClose={() => {
          if (savingBeforeSwitch) return;
          setPendingSwitchAction(null);
        }}
        title="Unsaved changes"
        description="This prompt has edits that haven't been saved yet."
      >
        {saveBeforeSwitchFailed && <p className={styles.errorBanner}>Couldn&apos;t save this prompt. Try again, or discard the changes.</p>}
        <div className={styles.switchDialogActions}>
          <Button variant="ghost" disabled={savingBeforeSwitch} onClick={() => setPendingSwitchAction(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={savingBeforeSwitch}
            onClick={() => {
              const action = pendingSwitchAction;
              setPendingSwitchAction(null);
              action?.();
            }}
          >
            Discard changes
          </Button>
          <Button loading={savingBeforeSwitch} onClick={() => void saveAndContinueSwitch()}>
            Save and continue
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this prompt list?"
        description="This will permanently remove this playlist and its prompts."
        confirmLabel="Delete prompt list"
        danger
        confirming={deletePlaylist.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deletePlaylist.mutate({ token, playlistId })}
      >
        {deletePlaylist.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this prompt list. Please try again.</p>}
      </ConfirmDialog>
    </motion.div>
  );
}
