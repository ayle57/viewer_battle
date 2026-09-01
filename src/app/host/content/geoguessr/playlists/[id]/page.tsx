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
import { RoundEditorPanel, type RoundEditorPanelHandle } from "./RoundEditorPanel";
import { RoundPreview } from "./RoundPreview";
import styles from "./page.module.css";

/**
 * GeoGuessr's playlist editor — item 3's "show preparation room": a
 * persistent round SIDEBAR (numbered, ✓/⚠ status) next to a single
 * MAIN editor panel (`RoundEditorPanel`) for whichever round is
 * selected, instead of a grid of cards that each opened a separate
 * modal. The sidebar doubles as the reorder interface (item 8) — the
 * same up/down arrows the old grid had, just now living next to the
 * thing they reorder instead of on a card the Host has to leave the
 * editor to see. A separate page from ../../jeopardy/playlists/[id]/
 * page.tsx, not a gameKey branch inside it — this pass's instruction is
 * explicit: don't touch Jeopardy's own files.
 */
export default function GeoPlaylistEditorPage() {
  const params = useParams<{ id: string }>();
  const playlistId = params.id;
  const searchParams = useSearchParams();
  const isFreshlyCreated = searchParams.get("new") === "1"; // set by the library's "+ Create Map Set" (page.tsx) — drives the name field's autofocus below
  const isDuplicated = searchParams.get("duplicated") === "1"; // set by duplicatePlaylist's own onSuccess redirect below — drives the transient confirmation banner
  const token = useContentIdentityStore((s) => s.token) ?? "";
  const router = useRouter();
  const utils = trpc.useUtils();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  const playlist = trpc.content.geoPlaylist.get.useQuery({ token, playlistId }, { enabled: Boolean(token && playlistId), retry: false });
  const invalidate = () => utils.content.geoPlaylist.get.invalidate({ token, playlistId });

  const updatePlaylist = trpc.content.geoPlaylist.update.useMutation({ onSuccess: () => void invalidate() });
  const duplicatePlaylist = trpc.content.geoPlaylist.duplicate.useMutation({
    onSuccess: (copy) => {
      void utils.content.geoPlaylist.list.invalidate();
      router.push(`/host/content/geoguessr/playlists/${copy.id}?duplicated=1`);
    },
  });
  const deletePlaylist = trpc.content.geoPlaylist.delete.useMutation({
    onSuccess: () => {
      void utils.content.geoPlaylist.list.invalidate();
      router.push("/host/content/geoguessr");
    },
  });
  // `createRound`/`duplicateRound` deliberately RETURN `invalidate()`'s
  // promise here, not `void`-discard it like every other mutation in
  // this file — a real, reproduced bug (found via a real browser, not a
  // code read): `handleAddRound`/`handleDuplicateRound` below each pass
  // their own per-call `onSuccess: (created) => setSelectedRoundId(created.id)`.
  // React Query runs a mutation's HOOK-level `onSuccess` before its
  // per-call one, and — this is the actual fix — AWAITS it first if it
  // returns a Promise. With the old `void invalidate()`, the per-call
  // `setSelectedRoundId` fired immediately, often BEFORE the cache
  // actually had the new round in it yet; the very next render's
  // "a round vanished out from under the selection" fallback (below)
  // then saw a `selectedRoundId` matching nothing in the still-stale
  // `detail.rounds` and immediately reset it back to `null` — silently
  // clobbering the just-made selection before the refetch ever landed.
  // Confirmed: every brand-new Map Set starts at 0 rounds, so this hit
  // the very first "+ Add Round" click on every single playlist a Host
  // ever created — the whole editor panel would just be blank. Properly
  // sequencing on the returned promise means the per-call `onSuccess`
  // now only runs once `detail.rounds` genuinely contains the new round.
  const createRound = trpc.content.geoRound.create.useMutation({ onSuccess: () => invalidate() });
  const duplicateRound = trpc.content.geoRound.duplicate.useMutation({ onSuccess: () => invalidate() });
  const deleteRound = trpc.content.geoRound.delete.useMutation({ onSuccess: () => void invalidate() });
  const reorderRounds = trpc.content.geoRound.reorder.useMutation({ onSuccess: () => void invalidate() });

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingDeleteRoundId, setPendingDeleteRoundId] = useState<string | null>(null);
  const [previewRoundId, setPreviewRoundId] = useState<string | null>(null);
  const [selectedRoundId, setSelectedRoundId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [showDuplicatedBanner, setShowDuplicatedBanner] = useState(isDuplicated);

  // Whether the CURRENTLY selected round's editor has local edits that
  // haven't been saved yet — reported up by RoundEditorPanel's own
  // `onDirtyChange` (see that component's doc comment). This page owns
  // every action that would remount the panel with a different round
  // (sidebar clicks, +Add Round, Duplicate round), so it's the one place
  // that can actually intercept one of those and ask first instead of
  // silently discarding the edit — a real, reproduced bug (found via a
  // real browser, not a code read): switching rounds without saving used
  // to lose the edit with zero warning.
  const [dirty, setDirty] = useState(false);
  // Holds the switch itself (not just "which round") so the SAME guard
  // covers three different actions — a sidebar click, +Add Round, and
  // Duplicate round — without three near-identical confirm flows.
  const [pendingSwitchAction, setPendingSwitchAction] = useState<(() => void) | null>(null);
  // The imperative handle onto the currently-mounted RoundEditorPanel —
  // see RoundEditorPanelHandle's own doc comment: this is what lets
  // "Save and continue" below actually save the CURRENT round before
  // switching, instead of only ever offering Cancel/Discard.
  const panelRef = useRef<RoundEditorPanelHandle>(null);
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

  // "Save and continue" — closes the real gap Jeopardy's own
  // `QuestionEditorDialog` doesn't have (it autosaves before ever
  // showing a dialog at all): this used to force a Host to either lose
  // the edit (Discard) or back out, manually hit Save, and retry the
  // exact same switch by hand. Deliberately still a real dialog, not a
  // fully silent autosave-on-navigate — see RoundEditorPanelHandle's own
  // doc comment on why an explicit choice stays here.
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

  // Keyboard fast-path, mirroring QuestionEditorDialog's own ArrowLeft/
  // ArrowRight navigation (Jeopardy's editor) — a real, audited
  // asymmetry: GeoGuessr had no keyboard way to move between rounds at
  // all. Same guard shape (never hijacks cursor movement while a text
  // field is focused, and — the one thing genuinely new here, since
  // Jeopardy's dialog has no equivalent — never hijacks the round map's
  // OWN arrow-key keyboard cursor either, ClickableImageMap.tsx's
  // `role="application"`; without this a Host trying to nudge their
  // keyboard-placed pin would also flip rounds out from under them on
  // every single arrow press). Reads the latest state through a ref, one
  // subscription for the page's whole lifetime, not per-render.
  const latestRoundNavRef = useRef({ selectedRoundId, rounds: playlist.data?.rounds ?? [], guardedSwitch });
  useEffect(() => {
    latestRoundNavRef.current = { selectedRoundId, rounds: playlist.data?.rounds ?? [], guardedSwitch };
  });
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const target = document.activeElement;
      const isEditableFocused = target instanceof HTMLElement && (target.tagName === "INPUT" || target.tagName === "TEXTAREA");
      const isMapFocused = target instanceof HTMLElement && target.closest('[role="application"]') !== null;
      if (isEditableFocused || isMapFocused) return;

      // Read through the ref, not the closure — `guardedSwitch` itself
      // closes over `dirty`, which changes on every render; this effect
      // only ever runs its setup once (`[]` below), so calling the
      // version captured then would silently check a stale `dirty`
      // forever.
      const { selectedRoundId: currentId, rounds, guardedSwitch: guard } = latestRoundNavRef.current;
      const ids = rounds.map((r) => r.id);
      const index = currentId ? ids.indexOf(currentId) : -1;
      if (index === -1) return;
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        guard(() => setSelectedRoundId(ids[index - 1]!));
      } else if (event.key === "ArrowRight" && index < ids.length - 1) {
        event.preventDefault();
        guard(() => setSelectedRoundId(ids[index + 1]!));
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // Deliberately once for the page's whole lifetime — everything this
    // handler needs is read through `latestRoundNavRef` (kept current
    // above), not closed over directly, same pattern QuestionEditorDialog.
    // tsx's own identical listener uses.
  }, []);

  // A quiet, self-dismissing confirmation (item 12: "pas de toast
  // permanent") — purely cosmetic UI feedback, not a state a game or
  // any backend record depends on, same class of timer as
  // GameStartingSequence's own beats. Runs once per page load, not per
  // render.
  useEffect(() => {
    if (!showDuplicatedBanner) return;
    const timeout = setTimeout(() => setShowDuplicatedBanner(false), 4000);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once on mount; re-arming on every `showDuplicatedBanner` flip would restart the timer right after dismissing it
  }, []);

  // Render-phase reset — same pattern/reasoning as Jeopardy's
  // syncedPlaylistId (page.tsx), not an effect+setState. Also seeds
  // `selectedRoundId` to the FIRST round the first time this playlist's
  // data ever arrives, so a Host opening an existing playlist lands
  // straight in its first round's editor, not an empty "pick one" state.
  const [syncedPlaylistId, setSyncedPlaylistId] = useState<string | undefined>(undefined);
  if (playlist.data && playlist.data.id !== syncedPlaylistId) {
    setSyncedPlaylistId(playlist.data.id);
    setName(playlist.data.name);
    setDescription(playlist.data.description ?? "");
    setSelectedRoundId(playlist.data.rounds[0]?.id ?? null);
  }
  // A round can vanish out from under the current selection (deleted in
  // another tab, or by this tab's own Delete — handled explicitly below,
  // but this also catches the "another tab" case) — fall back to the
  // new first round rather than leaving the main panel pointed at
  // nothing. Same derived-reset shape, keyed on the SET of round ids.
  if (playlist.data && selectedRoundId && !playlist.data.rounds.some((r) => r.id === selectedRoundId)) {
    setSelectedRoundId(playlist.data.rounds[0]?.id ?? null);
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
  const selectedIndex = detail.rounds.findIndex((r) => r.id === selectedRoundId);
  const selectedRound = selectedIndex >= 0 ? detail.rounds[selectedIndex]! : null;
  const previewRound = detail.rounds.find((r) => r.id === previewRoundId) ?? null;
  const previewIndex = previewRound ? detail.rounds.indexOf(previewRound) : -1;
  const pendingDeleteRound = detail.rounds.find((r) => r.id === pendingDeleteRoundId) ?? null;

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

  // "Save & Next Round" (item 7) — the panel already saved the CURRENT
  // round by the time this fires (RoundEditorPanel's own onSaved
  // contract). `mode: "stay"` needs nothing further. `mode: "next"`
  // either jumps to the round already sitting after this one in the
  // sidebar, or — if this was the LAST round — creates a fresh one and
  // jumps straight to it, so a Host preparing 12 maps never has to
  // separately reach for "+ Add Round" between every single one.
  function handleRoundSaved(mode: "stay" | "next") {
    if (mode === "stay" || !selectedRoundId) return;
    const ids = detail.rounds.map((r) => r.id);
    const nextId = ids[ids.indexOf(selectedRoundId) + 1];
    if (nextId) {
      setSelectedRoundId(nextId);
      return;
    }
    createRound.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedRoundId(created.id) });
  }

  function handleAddRound() {
    guardedSwitch(() => {
      createRound.mutate({ token, playlistId }, { onSuccess: (created) => setSelectedRoundId(created.id) });
    });
  }

  function handleDuplicateRound() {
    if (!selectedRoundId) return;
    guardedSwitch(() => {
      duplicateRound.mutate({ token, roundId: selectedRoundId }, { onSuccess: (created) => setSelectedRoundId(created.id) });
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
          { label: "GeoGuessr", href: "/host/content/geoguessr" },
          { label: detail.name },
        ]}
      />

      <div className={styles.header}>
        <AnimatePresence>
          {showDuplicatedBanner && (
            <motion.div className={styles.duplicatedBanner} initial="hidden" animate="show" exit="hidden" variants={fadeUp(reduced, { y: -6, duration: 0.25 })}>
              <span>✓ Map set duplicated</span>
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
                // A brand-new "Untitled Map Set" (see ../page.tsx's
                // handleCreate) is meaningless until renamed — autofocus +
                // select-all so the very next keystroke replaces it,
                // instead of the Host having to click in and select it
                // themselves (item 2's "focus the name automatically").
                autoFocus={isFreshlyCreated}
                onFocus={(event) => isFreshlyCreated && event.currentTarget.select()}
              />
              {/* The exact same badge (down to its own warning->success
                  pop transition) the Library grid and /host's content
                  picker already show for this playlist — one component,
                  never three different renderings of the same fact. */}
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

        {/* "12 ROUNDS · 9 READY · 3 NEED ATTENTION" + a progress bar —
            item 10's "raconter l'état du Map Set" without opening a
            single round. Same three numbers `ReadinessBadge` above and
            the sidebar's own ✓/⚠ glyphs already reflect; this is just
            the playlist-wide rollup of them. */}
        {detail.rounds.length > 0 && (
          <div className={styles.statsBlock}>
            <div className={styles.statsRow}>
              <span className={styles.statItem}>
                {detail.readiness.roundCount} ROUND{detail.readiness.roundCount === 1 ? "" : "S"}
              </span>
              <span className={[styles.statItem, styles.statOk].join(" ")}>{detail.readiness.completeRoundCount} READY</span>
              {detail.readiness.incompleteRounds.length > 0 && (
                <span className={[styles.statItem, styles.statWarn].join(" ")}>{detail.readiness.incompleteRounds.length} NEED ATTENTION</span>
              )}
            </div>
            <div className={styles.progressTrack} role="progressbar" aria-valuenow={detail.readiness.completeRoundCount} aria-valuemin={0} aria-valuemax={detail.readiness.roundCount}>
              <div className={styles.progressFill} style={{ width: `${(detail.readiness.completeRoundCount / detail.readiness.roundCount) * 100}%` }} />
            </div>
            <div className={styles.headerCta}>
              <Button
                variant="secondary"
                size="sm"
                disabled={!selectedRound}
                onClick={() => selectedRoundId && setPreviewRoundId(selectedRoundId)}
              >
                Preview
              </Button>
              {detail.readiness.ready ? (
                <Link href="/host">
                  <Button size="sm">Play →</Button>
                </Link>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => detail.readiness.firstProblemRoundId && setSelectedRoundId(detail.readiness.firstProblemRoundId)}
                >
                  Review missing rounds
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

      {detail.rounds.length === 0 ? (
        <div className={styles.emptyBoard}>
          <p className={styles.emptyTitle}>No rounds yet</p>
          <p>Add a round — a map, a question, and the correct location — to start building this show.</p>
          <Button loading={createRound.isPending} onClick={handleAddRound}>
            + Add Round
          </Button>
        </div>
      ) : (
        <div className={styles.editorLayout}>
          <nav className={styles.sidebar} aria-label="Rounds">
            <p className={styles.sidebarLabel}>
              {detail.rounds.length} round{detail.rounds.length === 1 ? "" : "s"}
            </p>
            <ol className={styles.roundList}>
              {detail.rounds.map((round, index) => {
                const state = roundSidebarState(round);
                const selected = round.id === selectedRoundId;
                return (
                  <li key={round.id}>
                    <div className={[styles.roundListItem, selected && styles.roundListItemSelected].filter(Boolean).join(" ")}>
                      <button type="button" className={styles.roundListButton} onClick={() => guardedSwitch(() => setSelectedRoundId(round.id))}>
                        <span className={styles.roundListNumber}>{String(index + 1).padStart(2, "0")}</span>
                        <span className={styles.roundListTitle}>{round.title || `Round ${index + 1}`}</span>
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
                          onClick={() => moveRound(round.id, -1)}
                          aria-label={`Move round ${index + 1} up`}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className={styles.roundOrderButton}
                          disabled={index === detail.rounds.length - 1}
                          onClick={() => moveRound(round.id, 1)}
                          aria-label={`Move round ${index + 1} down`}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
            <Button variant="secondary" size="sm" fullWidth loading={createRound.isPending} onClick={handleAddRound}>
              + Add Round
            </Button>
          </nav>

          <div className={styles.main}>
            {selectedRound && (
              // `key={selectedRound.id}` here (not just on the panel one
              // level down) is what makes a round SWITCH read as a real
              // transition (item 17) instead of a hard cut — the whole
              // subtree, RoundEditorPanel included, genuinely remounts,
              // which is also exactly what resets the panel's own local
              // buffer state (see that component's own doc comment).
              <motion.div key={selectedRound.id} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 10, duration: 0.3 })}>
                <RoundEditorPanel
                  ref={panelRef}
                  token={token}
                  playlistId={playlistId}
                  round={selectedRound}
                  roundNumber={selectedIndex + 1}
                  hasNextRound={selectedIndex < detail.rounds.length - 1}
                  onSaved={handleRoundSaved}
                  onDuplicate={handleDuplicateRound}
                  duplicating={duplicateRound.isPending}
                  onRequestDelete={() => setPendingDeleteRoundId(selectedRound.id)}
                  onPreview={() => setPreviewRoundId(selectedRound.id)}
                  onDirtyChange={setDirty}
                />
              </motion.div>
            )}
          </div>
        </div>
      )}

      {previewRound && <RoundPreview round={previewRound} roundNumber={previewIndex + 1} onClose={() => setPreviewRoundId(null)} />}

      <ConfirmDialog
        open={pendingDeleteRoundId !== null}
        title="Delete this round?"
        description={pendingDeleteRound ? `"${pendingDeleteRound.title || "This round"}" will be permanently removed from this playlist.` : undefined}
        confirmLabel="Delete round"
        danger
        confirming={deleteRound.isPending}
        onCancel={() => setPendingDeleteRoundId(null)}
        onConfirm={() => {
          if (!pendingDeleteRoundId) return;
          deleteRound.mutate({ token, roundId: pendingDeleteRoundId }, { onSuccess: () => setPendingDeleteRoundId(null) });
        }}
      >
        {deleteRound.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this round. Please try again.</p>}
      </ConfirmDialog>

      {/* A real `Dialog`, not `ConfirmDialog` — this is the one place in
          the Studio a Host is offered THREE real outcomes (Cancel,
          Discard, or Save and continue), not two, so it doesn't fit
          ConfirmDialog's own Cancel/Confirm-only shape. Button order is
          deliberate: on the ConfirmDialog's own mobile layout the LAST
          button ends up closest to the thumb (`column-reverse`, see that
          component's own `.actions` rule) — "Save and continue" (the
          safe, recommended choice) is placed last here on purpose, same
          reasoning, so it's the easiest one to reach on a phone too. */}
      <Dialog
        open={pendingSwitchAction !== null}
        onClose={() => {
          if (savingBeforeSwitch) return;
          setPendingSwitchAction(null);
        }}
        title="Unsaved changes"
        description="This round has edits that haven't been saved yet."
      >
        {saveBeforeSwitchFailed && <p className={styles.errorBanner}>Couldn&apos;t save this round. Try again, or discard the changes.</p>}
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
        title="Delete this map set?"
        description="This will permanently remove this playlist and its rounds."
        confirmLabel="Delete map set"
        danger
        confirming={deletePlaylist.isPending}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => deletePlaylist.mutate({ token, playlistId })}
      >
        {deletePlaylist.isError && <p className={styles.errorBanner}>Couldn&apos;t delete this map set. Please try again.</p>}
      </ConfirmDialog>
    </motion.div>
  );
}

/**
 * A three-way read of the SAME fields `isRoundComplete`/
 * `getGeoPlaylistReadiness` already check (src/domain/content) — never
 * a second readiness rule, just a finer-grained rendering of the one
 * that exists. "empty" (a round shell with literally nothing filled in
 * yet — item 2's "04 —") reads differently from "incomplete" (SOME
 * fields set, genuinely mid-edit — "⚠") even though both are equally
 * "not ready" to `isRoundComplete`'s own boolean; the sidebar is exactly
 * the one place that distinction is worth making, so a Host scanning it
 * can tell "never touched" apart from "started, not finished" at a
 * glance.
 */
function roundSidebarState(round: { imageUrl: string | null; question: string | null; targetX: number | null; targetY: number | null }): "empty" | "incomplete" | "ready" {
  const hasImage = Boolean(round.imageUrl);
  const hasQuestion = Boolean(round.question);
  const hasTarget = round.targetX !== null && round.targetY !== null;
  if (hasImage && hasQuestion && hasTarget) return "ready";
  if (!hasImage && !hasQuestion && !hasTarget) return "empty";
  return "incomplete";
}
