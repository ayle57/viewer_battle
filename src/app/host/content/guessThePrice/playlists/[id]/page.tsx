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
import { ItemEditorPanel } from "./ItemEditorPanel";
import styles from "./page.module.css";

/**
 * Guess the Price's playlist editor — the same "persistent item SIDEBAR
 * next to a single MAIN editor panel" shape as ../../steamRatings/
 * playlists/[id]/page.tsx / ../../music/playlists/[id]/page.tsx, adapted
 * for this game's own flat item list (title + photo + price + optional
 * margin, no target/question/ratings array). A separate page from every
 * other game's own, same reasoning: don't touch another game's files.
 */
export default function GuessThePricePlaylistEditorPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const searchParams = useSearchParams();
  const isFreshlyCreated = searchParams.get("new") === "1"; // set by the library's "+ Create Playlist" — drives the name field's autofocus below
  const isDuplicated = searchParams.get("duplicated") === "1"; // set by duplicatePlaylist's own onSuccess redirect below — drives the transient confirmation banner
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const router = useRouter();
  const utils = trpc.useUtils();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  const playlist = trpc.content.pricePlaylist.get.useQuery({ token, playlistId }, { enabled: Boolean(token && playlistId), retry: false });
  const invalidate = () => utils.content.pricePlaylist.get.invalidate({ token, playlistId });

  const updatePlaylist = trpc.content.pricePlaylist.update.useMutation({ onSuccess: () => void invalidate() });
  const duplicatePlaylist = trpc.content.pricePlaylist.duplicate.useMutation({
    onSuccess: (copy) => {
      void utils.content.pricePlaylist.list.invalidate();
      router.push(`/host/content/guessThePrice/playlists/${copy.id}?duplicated=1`);
    },
  });
  const deletePlaylist = trpc.content.pricePlaylist.delete.useMutation({
    onSuccess: () => {
      void utils.content.pricePlaylist.list.invalidate();
      router.push("/host/content/guessThePrice");
    },
  });
  // `createItem`/`duplicateItem` deliberately RETURN `invalidate()`'s
  // promise, not `void`-discard it — same fix as GeoGuessr's own
  // createRound/duplicateRound (see that file's own doc comment for the
  // real, reproduced race this closes: a per-call `onSuccess` selecting
  // the new row could otherwise fire before the cache actually held it).
  const createItem = trpc.content.priceItem.create.useMutation({ onSuccess: () => invalidate() });
  const duplicateItem = trpc.content.priceItem.duplicate.useMutation({ onSuccess: () => invalidate() });
  const deleteItem = trpc.content.priceItem.delete.useMutation({ onSuccess: () => void invalidate() });
  const reorderPriceItems = trpc.content.priceItem.reorder.useMutation({ onSuccess: () => void invalidate() });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showDuplicatedBanner, setShowDuplicatedBanner] = useState(isDuplicated);

  // Same "own panel reports dirty, this page owns every switch action"
  // contract as GeoGuessr's own editor page — see ItemEditorPanel's own
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
    setSelectedItemId(playlist.data.priceItems[0]?.id ?? null);
  }
  // An item can vanish out from under the current selection (deleted in
  // another tab, or by this tab's own Delete) — fall back to the new
  // first item rather than leaving the main panel pointed at nothing.
  if (playlist.data && selectedItemId && !playlist.data.priceItems.some((t) => t.id === selectedItemId)) {
    setSelectedItemId(playlist.data.priceItems[0]?.id ?? null);
  }

  if (playlist.isError) {
    return (
      <div className={styles.emptyBoard}>
        <p className={styles.emptyTitle}>Playlist not found.</p>
        <p>It may have been deleted, or it belongs to a different Content Studio identity.</p>
        <Link href="/host/content/guessThePrice">
          <Button>← Back to Guess the Price</Button>
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
  const selectedIndex = detail.priceItems.findIndex((t) => t.id === selectedItemId);
  const selectedItem = selectedIndex >= 0 ? detail.priceItems[selectedIndex]! : null;
  const pendingDeleteItem = detail.priceItems.find((t) => t.id === pendingDeleteItemId) ?? null;

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

  function moveItem(itemId: string, direction: -1 | 1) {
    const ids = detail.priceItems.map((t) => t.id);
    const index = ids.indexOf(itemId);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderPriceItems.mutate({ token, playlistId, orderedItemIds: ids });
  }

  // "Save & Next Item" — same shape as GeoGuessr's own handleRoundSaved:
  // jump to the item already sitting after this one, or create a fresh
  // one if this was the last.
  function handleItemSaved(mode: "stay" | "next") {
    if (mode === "stay" || !selectedItemId) return;
    const ids = detail.priceItems.map((t) => t.id);
    const nextId = ids[ids.indexOf(selectedItemId) + 1];
    if (nextId) {
      setSelectedItemId(nextId);
      return;
    }
    createItem.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedItemId(created.id) });
  }

  function handleAddItem() {
    guardedSwitch(() => {
      createItem.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedItemId(created.id) });
    });
  }

  function handleDuplicateItem() {
    if (!selectedItemId) return;
    guardedSwitch(() => {
      duplicateItem.mutate({ token, itemId: selectedItemId }, { onSuccess: (created) => setSelectedItemId(created.id) });
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
          { label: "Guess the Price", href: "/host/content/guessThePrice" },
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

        {detail.priceItems.length > 0 && (
          <div className={styles.statsBlock}>
            <div className={styles.statsRow}>
              <span className={styles.statItem}>
                {detail.readiness.itemCount} ITEM{detail.readiness.itemCount === 1 ? "" : "S"}
              </span>
              <span className={[styles.statItem, styles.statOk].join(" ")}>{detail.readiness.completeItemCount} READY</span>
              {detail.readiness.incompleteItems.length > 0 && (
                <span className={[styles.statItem, styles.statWarn].join(" ")}>{detail.readiness.incompleteItems.length} NEED ATTENTION</span>
              )}
            </div>
            <div className={styles.progressTrack} role="progressbar" aria-valuenow={detail.readiness.completeItemCount} aria-valuemin={0} aria-valuemax={detail.readiness.itemCount}>
              <div className={styles.progressFill} style={{ width: `${(detail.readiness.completeItemCount / detail.readiness.itemCount) * 100}%` }} />
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
                  onClick={() => detail.readiness.firstProblemItemId && setSelectedItemId(detail.readiness.firstProblemItemId)}
                >
                  Review missing items
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

      {detail.priceItems.length === 0 ? (
        <div className={styles.emptyBoard}>
          <p className={styles.emptyTitle}>No items yet</p>
          <p>Add an item — its name, a photo, and its real price — to start building this show.</p>
          <Button loading={createItem.isPending} onClick={handleAddItem}>
            + Add Item
          </Button>
        </div>
      ) : (
        <div className={styles.editorLayout}>
          <nav className={styles.sidebar} aria-label="Items">
            <p className={styles.sidebarLabel}>
              {detail.priceItems.length} item{detail.priceItems.length === 1 ? "" : "s"}
            </p>
            <ol className={styles.roundList}>
              {detail.priceItems.map((item, index) => {
                const state = itemSidebarState(item);
                const selected = item.id === selectedItemId;
                return (
                  <li key={item.id}>
                    <div className={[styles.roundListItem, selected && styles.roundListItemSelected].filter(Boolean).join(" ")}>
                      <button type="button" className={styles.roundListButton} onClick={() => guardedSwitch(() => setSelectedItemId(item.id))}>
                        <span className={styles.roundListNumber}>{String(index + 1).padStart(2, "0")}</span>
                        <span className={styles.roundListTitle}>{item.title || `Item ${index + 1}`}</span>
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
                          onClick={() => moveItem(item.id, -1)}
                          aria-label={`Move item ${index + 1} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.roundOrderButton}
                          disabled={index === detail.priceItems.length - 1}
                          onClick={() => moveItem(item.id, 1)}
                          aria-label={`Move item ${index + 1} down`}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <Button variant="secondary" size="sm" fullWidth loading={createItem.isPending} onClick={handleAddItem}>
              + Add Item
            </Button>
          </nav>

          <div className={styles.main}>
            {selectedItem && (
              // `key={selectedItem.id}` remounts the whole subtree on an
              // item switch — same reasoning as GeoGuessr's own editor
              // (resets ItemEditorPanel's local buffer, see that
              // component's own doc comment).
              <motion.div key={selectedItem.id} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 10, duration: 0.3 })}>
                <ItemEditorPanel
                  token={token}
                  playlistId={playlistId}
                  item={selectedItem}
                  itemNumber={selectedIndex + 1}
                  hasNextItem={selectedIndex < detail.priceItems.length - 1}
                  onSaved={handleItemSaved}
                  onDuplicate={handleDuplicateItem}
                  duplicating={duplicateItem.isPending}
                  onRequestDelete={() => setPendingDeleteItemId(selectedItem.id)}
                  onDirtyChange={setDirty}
                />
              </motion.div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteItemId !== null}
        title="Delete this item?"
        description={pendingDeleteItem ? `"${pendingDeleteItem.title || "This item"}" will be permanently removed from this playlist.` : undefined}
        confirmLabel="Delete item"
        danger
        confirming={deleteItem.isPending}
        onCancel={() => setPendingDeleteItemId(null)}
        onConfirm={() => {
          if (!pendingDeleteItemId) return;
          deleteItem.mutate({ token, itemId: pendingDeleteItemId }, { onSuccess: () => setPendingDeleteItemId(null) });
        }}
      >
        {deleteItem.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this item. Please try again.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingSwitchAction !== null}
        title="Discard unsaved changes?"
        description="This item has edits that haven't been saved yet. Switching now will lose them."
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
        description="This will permanently remove this playlist and its items."
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
 * A three-way read of the SAME fields `isPriceItemComplete`/
 * `getGuessThePricePlaylistReadiness` already check (src/domain/content)
 * — same "empty vs. incomplete vs. ready" distinction GeoGuessr's own
 * roundSidebarState makes. "Empty" here means genuinely nothing filled
 * in yet (a freshly-created shell row); any partial progress — a title
 * but no photo, a price but no title, etc — reads as "incomplete", not
 * "empty".
 */
function itemSidebarState(item: { title: string | null; imageUrl: string | null; price: number | null }): "empty" | "incomplete" | "ready" {
  const hasTitle = Boolean(item.title);
  const hasImage = Boolean(item.imageUrl);
  const hasPrice = item.price !== null;
  if (hasTitle && hasImage && hasPrice) return "ready";
  if (!hasTitle && !hasImage && !hasPrice) return "empty";
  return "incomplete";
}
