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
import { GameEditorPanel } from "./GameEditorPanel";
import styles from "./page.module.css";

/**
 * Steam Ratings' playlist editor — the same "persistent game SIDEBAR
 * next to a single MAIN editor panel" shape as ../../geoguessr/
 * playlists/[id]/page.tsx / ../../music/playlists/[id]/page.tsx, adapted
 * for this game's own flat game list (title + cover image + an ordered
 * ratings array, no target/question). A separate page from every other
 * game's own, same reasoning: don't touch another game's files.
 */
export default function SteamRatingsPlaylistEditorPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const searchParams = useSearchParams();
  const isFreshlyCreated = searchParams.get("new") === "1"; // set by the library's "+ Create Playlist" — drives the name field's autofocus below
  const isDuplicated = searchParams.get("duplicated") === "1"; // set by duplicatePlaylist's own onSuccess redirect below — drives the transient confirmation banner
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const router = useRouter();
  const utils = trpc.useUtils();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  const playlist = trpc.content.steamPlaylist.get.useQuery({ token, playlistId }, { enabled: Boolean(token && playlistId), retry: false });
  const invalidate = () => utils.content.steamPlaylist.get.invalidate({ token, playlistId });

  const updatePlaylist = trpc.content.steamPlaylist.update.useMutation({ onSuccess: () => void invalidate() });
  const duplicatePlaylist = trpc.content.steamPlaylist.duplicate.useMutation({
    onSuccess: (copy) => {
      void utils.content.steamPlaylist.list.invalidate();
      router.push(`/host/content/steamRatings/playlists/${copy.id}?duplicated=1`);
    },
  });
  const deletePlaylist = trpc.content.steamPlaylist.delete.useMutation({
    onSuccess: () => {
      void utils.content.steamPlaylist.list.invalidate();
      router.push("/host/content/steamRatings");
    },
  });
  // `createGame`/`duplicateGame` deliberately RETURN `invalidate()`'s
  // promise, not `void`-discard it — same fix as GeoGuessr's own
  // createRound/duplicateRound (see that file's own doc comment for the
  // real, reproduced race this closes: a per-call `onSuccess` selecting
  // the new row could otherwise fire before the cache actually held it).
  const createGame = trpc.content.steamGame.create.useMutation({ onSuccess: () => invalidate() });
  const duplicateGame = trpc.content.steamGame.duplicate.useMutation({ onSuccess: () => invalidate() });
  const deleteGame = trpc.content.steamGame.delete.useMutation({ onSuccess: () => void invalidate() });
  const reorderSteamGames = trpc.content.steamGame.reorder.useMutation({ onSuccess: () => void invalidate() });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDeleteGameId, setPendingDeleteGameId] = useState<string | null>(null);
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showDuplicatedBanner, setShowDuplicatedBanner] = useState(isDuplicated);

  // Same "own panel reports dirty, this page owns every switch action"
  // contract as GeoGuessr's own editor page — see GameEditorPanel's own
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
    setSelectedGameId(playlist.data.steamGames[0]?.id ?? null);
  }
  // A game can vanish out from under the current selection (deleted in
  // another tab, or by this tab's own Delete) — fall back to the new
  // first game rather than leaving the main panel pointed at nothing.
  if (playlist.data && selectedGameId && !playlist.data.steamGames.some((t) => t.id === selectedGameId)) {
    setSelectedGameId(playlist.data.steamGames[0]?.id ?? null);
  }

  if (playlist.isError) {
    return (
      <div className={styles.emptyBoard}>
        <p className={styles.emptyTitle}>Playlist not found.</p>
        <p>It may have been deleted, or it belongs to a different Content Studio identity.</p>
        <Link href="/host/content/steamRatings">
          <Button>← Back to Guess the Game</Button>
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
  const selectedIndex = detail.steamGames.findIndex((t) => t.id === selectedGameId);
  const selectedGame = selectedIndex >= 0 ? detail.steamGames[selectedIndex]! : null;
  const pendingDeleteGame = detail.steamGames.find((t) => t.id === pendingDeleteGameId) ?? null;

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

  function moveGame(gameId: string, direction: -1 | 1) {
    const ids = detail.steamGames.map((t) => t.id);
    const index = ids.indexOf(gameId);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorderSteamGames.mutate({ token, playlistId, orderedGameIds: ids });
  }

  // "Save & Next Game" — same shape as GeoGuessr's own handleRoundSaved:
  // jump to the game already sitting after this one, or create a fresh
  // one if this was the last.
  function handleGameSaved(mode: "stay" | "next") {
    if (mode === "stay" || !selectedGameId) return;
    const ids = detail.steamGames.map((t) => t.id);
    const nextId = ids[ids.indexOf(selectedGameId) + 1];
    if (nextId) {
      setSelectedGameId(nextId);
      return;
    }
    createGame.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedGameId(created.id) });
  }

  function handleAddGame() {
    guardedSwitch(() => {
      createGame.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedGameId(created.id) });
    });
  }

  function handleDuplicateGame() {
    if (!selectedGameId) return;
    guardedSwitch(() => {
      duplicateGame.mutate({ token, gameId: selectedGameId }, { onSuccess: (created) => setSelectedGameId(created.id) });
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
          { label: "Guess the Game", href: "/host/content/steamRatings" },
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

        {detail.steamGames.length > 0 && (
          <div className={styles.statsBlock}>
            <div className={styles.statsRow}>
              <span className={styles.statItem}>
                {detail.readiness.gameCount} GAME{detail.readiness.gameCount === 1 ? "" : "S"}
              </span>
              <span className={[styles.statItem, styles.statOk].join(" ")}>{detail.readiness.completeGameCount} READY</span>
              {detail.readiness.incompleteGames.length > 0 && (
                <span className={[styles.statItem, styles.statWarn].join(" ")}>{detail.readiness.incompleteGames.length} NEED ATTENTION</span>
              )}
            </div>
            <div className={styles.progressTrack} role="progressbar" aria-valuenow={detail.readiness.completeGameCount} aria-valuemin={0} aria-valuemax={detail.readiness.gameCount}>
              <div className={styles.progressFill} style={{ width: `${(detail.readiness.completeGameCount / detail.readiness.gameCount) * 100}%` }} />
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
                  onClick={() => detail.readiness.firstProblemGameId && setSelectedGameId(detail.readiness.firstProblemGameId)}
                >
                  Review missing games
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

      {detail.steamGames.length === 0 ? (
        <div className={styles.emptyBoard}>
          <p className={styles.emptyTitle}>No games yet</p>
          <p>Add a game — its name, a cover image, and the Steam reviews that give it away — to start building this show.</p>
          <Button loading={createGame.isPending} onClick={handleAddGame}>
            + Add Game
          </Button>
        </div>
      ) : (
        <div className={styles.editorLayout}>
          <nav className={styles.sidebar} aria-label="Games">
            <p className={styles.sidebarLabel}>
              {detail.steamGames.length} game{detail.steamGames.length === 1 ? "" : "s"}
            </p>
            <ol className={styles.roundList}>
              {detail.steamGames.map((game, index) => {
                const state = gameSidebarState(game);
                const selected = game.id === selectedGameId;
                return (
                  <li key={game.id}>
                    <div className={[styles.roundListItem, selected && styles.roundListItemSelected].filter(Boolean).join(" ")}>
                      <button type="button" className={styles.roundListButton} onClick={() => guardedSwitch(() => setSelectedGameId(game.id))}>
                        <span className={styles.roundListNumber}>{String(index + 1).padStart(2, "0")}</span>
                        <span className={styles.roundListTitle}>{game.title || `Game ${index + 1}`}</span>
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
                          onClick={() => moveGame(game.id, -1)}
                          aria-label={`Move game ${index + 1} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.roundOrderButton}
                          disabled={index === detail.steamGames.length - 1}
                          onClick={() => moveGame(game.id, 1)}
                          aria-label={`Move game ${index + 1} down`}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <Button variant="secondary" size="sm" fullWidth loading={createGame.isPending} onClick={handleAddGame}>
              + Add Game
            </Button>
          </nav>

          <div className={styles.main}>
            {selectedGame && (
              // `key={selectedGame.id}` remounts the whole subtree on a
              // game switch — same reasoning as GeoGuessr's own editor
              // (resets GameEditorPanel's local buffer, see that
              // component's own doc comment).
              <motion.div key={selectedGame.id} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 10, duration: 0.3 })}>
                <GameEditorPanel
                  token={token}
                  playlistId={playlistId}
                  game={selectedGame}
                  gameNumber={selectedIndex + 1}
                  hasNextGame={selectedIndex < detail.steamGames.length - 1}
                  onSaved={handleGameSaved}
                  onDuplicate={handleDuplicateGame}
                  duplicating={duplicateGame.isPending}
                  onRequestDelete={() => setPendingDeleteGameId(selectedGame.id)}
                  onDirtyChange={setDirty}
                />
              </motion.div>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={pendingDeleteGameId !== null}
        title="Delete this game?"
        description={pendingDeleteGame ? `"${pendingDeleteGame.title || "This game"}" will be permanently removed from this playlist.` : undefined}
        confirmLabel="Delete game"
        danger
        confirming={deleteGame.isPending}
        onCancel={() => setPendingDeleteGameId(null)}
        onConfirm={() => {
          if (!pendingDeleteGameId) return;
          deleteGame.mutate({ token, gameId: pendingDeleteGameId }, { onSuccess: () => setPendingDeleteGameId(null) });
        }}
      >
        {deleteGame.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this game. Please try again.</p>}
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingSwitchAction !== null}
        title="Discard unsaved changes?"
        description="This game has edits that haven't been saved yet. Switching now will lose them."
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
        description="This will permanently remove this playlist and its games."
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
 * A three-way read of the SAME fields `isGameComplete`/
 * `getSteamRatingsPlaylistReadiness` already check (src/domain/content)
 * — same "empty vs. incomplete vs. ready" distinction GeoGuessr's own
 * roundSidebarState makes. "Empty" here means genuinely nothing filled
 * in yet (a freshly-created shell row); any partial progress — a title
 * but no cover, ratings but no title, etc — reads as "incomplete", not
 * "empty".
 */
function gameSidebarState(game: { title: string | null; imageUrl: string | null; ratings: string[] }): "empty" | "incomplete" | "ready" {
  const hasTitle = Boolean(game.title);
  const hasImage = Boolean(game.imageUrl);
  const hasRatings = game.ratings.length > 0;
  if (hasTitle && hasImage && hasRatings) return "ready";
  if (!hasTitle && !hasImage && !hasRatings) return "empty";
  return "incomplete";
}
