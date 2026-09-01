"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, ConfirmDialog, ImageWithFallback, Input } from "@/ui";
import { SaveStatus, type SaveState } from "../../../_shared/SaveStatus";
import { useSteamAssetUpload } from "./useSteamAssetUpload";
import styles from "./GameEditorPanel.module.css";

const MAX_RATINGS = 10;

export interface GameEditorPanelGame {
  id: string;
  title: string | null;
  imageUrl: string | null;
  ratings: string[];
}

export interface GameEditorPanelProps {
  token: string;
  playlistId: string;
  game: GameEditorPanelGame;
  gameNumber: number;
  /** Whether the sidebar already has a game after this one — decides what "Save & Next Game" actually does (jump to it vs. create a fresh one), computed by the parent, same shape as MusicEngine's own TrackEditorPanel. */
  hasNextGame: boolean;
  onSaved: (mode: "stay" | "next") => void;
  onDuplicate: () => void;
  duplicating: boolean;
  onRequestDelete: () => void;
  /**
   * Reports whether this game's LOCAL buffer currently differs from
   * what's actually saved — same "own panel, own dirty state" contract
   * as every other game's own editor panel in this app.
   */
  onDirtyChange: (dirty: boolean) => void;
}

/** "Missing:" list order, matching the on-screen field order top to bottom (Title -> Cover -> Ratings) — same "next step always points at the closest gap" reasoning as GeoGuessr's own missingSteps. */
function missingSteps(hasTitle: boolean, hasImage: boolean, hasRatings: boolean): string[] {
  const missing: string[] = [];
  if (!hasTitle) missing.push("Title");
  if (!hasImage) missing.push("Cover image");
  if (!hasRatings) missing.push("At least one rating");
  return missing;
}

const NEXT_STEP_COPY: Record<string, string> = {
  Title: "Give this game a title — what the Host will judge answers against.",
  "Cover image": "Upload or pick a cover image, revealed once the round ends.",
  "At least one rating": "Add at least one Steam rating — the least obvious one goes first.",
};

/**
 * The game editor's MAIN panel — same "persistent sidebar next to one
 * main panel" shape as MusicEngine's own TrackEditorPanel, adapted for
 * this game's own content shape (title + cover image + an ORDERED
 * ratings array, no audio/artist). `key={game.id}` at the call site
 * resets this panel's local buffer on a game switch, same reasoning as
 * that component's own doc comment.
 *
 * Cover selection reads content.steamAsset.list (src/server/content/
 * steamAssets.ts) — whatever's actually on disk under public/images/
 * steam, never a hardcoded list — plus drag & drop / browse upload that
 * POSTs straight to src/app/api/content/steam-assets/route.ts (gated
 * behind this same `token`) and adds the result to that same pool,
 * selected immediately.
 *
 * The ratings list is genuinely new UI, not shared with any other
 * game's editor: a plain ordered array of short strings, edited entirely
 * in this panel's own local buffer (add/edit/remove/reorder) and saved
 * as ONE array on Save — see contentSteam.ts's updateSteamGame, which
 * replaces the whole `ratings` column rather than diffing individual
 * entries (prisma/schema.prisma's own doc comment on PlaylistSteamGame
 * explains why a rating has no separate identity worth a child row).
 */
export function GameEditorPanel({ token, playlistId, game, gameNumber, hasNextGame, onSaved, onDuplicate, duplicating, onRequestDelete, onDirtyChange }: GameEditorPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const utils = trpc.useUtils();
  const assets = trpc.content.steamAsset.list.useQuery();
  const updateGame = trpc.content.steamGame.update.useMutation();
  const deleteAsset = trpc.content.steamAsset.delete.useMutation();
  const { upload, uploading, progress, error: uploadError, clearError: clearUploadError } = useSteamAssetUpload(token);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState(game.title ?? "");
  const [imageUrl, setImageUrl] = useState(game.imageUrl ?? "");
  const [ratings, setRatings] = useState<string[]>(game.ratings.length > 0 ? game.ratings : [""]);
  // Present -> the dropzone/asset-picker is showing even though a cover is
  // already chosen (the Host clicked "Replace") — see the Cover section
  // below. Starts true whenever there's no cover yet.
  const [replacingImage, setReplacingImage] = useState(!game.imageUrl);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState<{ url: string; name: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pendingMode, setPendingMode] = useState<"stay" | "next" | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // What's ACTUALLY saved right now — same "own local baseline, not the
  // `game` prop" reasoning as GeoGuessr's own savedSnapshot. `ratings`
  // compared by JSON — a plain array `!==` would always be true (two
  // different array references), same as any other "does my buffer
  // still match what's saved" check over a list.
  const [savedSnapshot, setSavedSnapshot] = useState({ title: game.title ?? "", imageUrl: game.imageUrl ?? "", ratings: game.ratings });
  const meaningfulRatings = ratings.filter((r) => r.trim().length > 0);
  const isDirty =
    title !== savedSnapshot.title ||
    imageUrl !== savedSnapshot.imageUrl ||
    JSON.stringify(meaningfulRatings) !== JSON.stringify(savedSnapshot.ratings);

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), []); // eslint-disable-line react-hooks/exhaustive-deps -- deliberately only on unmount, not tied to onDirtyChange identity

  const hasImage = Boolean(imageUrl);
  const hasTitle = Boolean(title.trim());
  const hasRatings = meaningfulRatings.length > 0;
  const ready = hasImage && hasTitle && hasRatings;
  const missing = missingSteps(hasTitle, hasImage, hasRatings);

  // Same "land on whichever field actually needs attention first"
  // priority as MusicEngine's own TrackEditorPanel — the title field's
  // own share of this is just its plain `autoFocus` prop below.
  useEffect(() => {
    if (hasTitle && !hasImage) dropzoneRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once per mount (a game switch, via `key={game.id}` at the call site)
  }, []);

  function save(mode: "stay" | "next") {
    setPendingMode(mode);
    setSaveState("saving");
    updateGame.mutate(
      {
        token,
        gameId: game.id,
        title: title.trim() || null,
        imageUrl: imageUrl || null,
        ratings: meaningfulRatings,
      },
      {
        onSuccess: () => {
          void utils.content.steamPlaylist.get.invalidate({ token, playlistId });
          setSavedSnapshot({ title, imageUrl, ratings: meaningfulRatings });
          setPendingMode(null);
          setSaveState("saved");
          onSaved(mode);
        },
        onError: () => {
          setPendingMode(null);
          setSaveState("error");
        },
      },
    );
  }

  // Cmd/Ctrl+Enter -> Save & Next, same shortcut every other game's own
  // editor panel offers, scoped to this panel's own root.
  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save("next");
    }
  }

  async function handleFile(file: File) {
    const asset = await upload(file);
    if (!asset) return; // useSteamAssetUpload already recorded the error
    void utils.content.steamAsset.list.invalidate();
    setImageUrl(asset.url); // uploading a cover is choosing it — no separate "now pick it from the list" step
    setReplacingImage(false);
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets picking the SAME file again re-fire onChange
    if (!file) return;
    await handleFile(file);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!dragActive) setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setDragActive(false);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    await handleFile(file);
  }

  function handleDeleteAsset() {
    if (!pendingDeleteAsset) return;
    deleteAsset.mutate(
      { token, url: pendingDeleteAsset.url },
      {
        onSuccess: () => {
          void utils.content.steamAsset.list.invalidate();
          // A game mid-edit that had this exact cover selected loses it
          // too — keeping a phantom selection pointing at a file that no
          // longer exists would silently ship a broken image on Save.
          if (imageUrl === pendingDeleteAsset.url) {
            setImageUrl("");
            setReplacingImage(true);
          }
          setPendingDeleteAsset(null);
        },
      },
    );
  }

  function updateRating(index: number, text: string) {
    setRatings((prev) => prev.map((r, i) => (i === index ? text : r)));
  }

  function addRating() {
    if (ratings.length >= MAX_RATINGS) return;
    setRatings((prev) => [...prev, ""]);
  }

  function removeRating(index: number) {
    setRatings((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : [""]));
  }

  function moveRating(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ratings.length) return;
    setRatings((prev) => {
      const next = [...prev];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <div className={styles.panel} onKeyDown={handlePanelKeyDown}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.roundEyebrow}>GAME {String(gameNumber).padStart(2, "0")}</p>
          <h2 className={styles.roundTitle}>{title.trim() || "Untitled game"}</h2>
        </div>
        <div className={styles.headerRight}>
          <SaveStatus state={saveState} />
          <motion.span key={ready ? "ready" : "not-ready"} initial="hidden" animate="show" variants={popIn(reduced)}>
            <Badge variant={ready ? "success" : "warning"} dot>
              {ready ? "✓ READY" : "⚠ NOT READY"}
            </Badge>
          </motion.span>
        </div>
      </div>

      <div className={[styles.readinessPanel, ready ? styles.readinessPanelOk : styles.readinessPanelWarn].join(" ")}>
        {ready ? (
          <p className={styles.readinessLine}>Everything is set for this game.</p>
        ) : (
          <>
            <p className={styles.readinessLine}>
              Missing: <strong>{missing.join(", ")}</strong>
            </p>
            <p className={styles.nextStepLine}>
              <span className={styles.nextStepLabel}>NEXT STEP</span> {NEXT_STEP_COPY[missing[0]!]}
            </p>
          </>
        )}
      </div>

      <div className={styles.form}>
        <div>
          <p className={styles.fieldLabel}>
            Title {hasTitle && <span className={styles.fieldLabelOk}>✓</span>}
          </p>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Hollow Knight" aria-label="Game title" autoFocus={!hasTitle} />
          <p className={styles.hint}>The reference answer — what the Host judges a team&apos;s guess against. Revealed to everyone once the round ends.</p>
        </div>

        <div>
          <p className={styles.fieldLabel}>
            Cover image {hasImage && <span className={styles.fieldLabelOk}>✓</span>}
          </p>

          {hasImage && !replacingImage ? (
            <motion.div className={styles.imagePreview} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 8, duration: 0.35 })}>
              <ImageWithFallback src={imageUrl} alt="" className={styles.imagePreviewImg} fallbackLabel="Cover unavailable — try Replace" />
              <div className={styles.imagePreviewActions}>
                <Button type="button" variant="secondary" size="sm" onClick={() => setReplacingImage(true)}>
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setImageUrl("");
                    setReplacingImage(true);
                  }}
                >
                  Remove
                </Button>
              </div>
            </motion.div>
          ) : (
            <>
              <div
                ref={dropzoneRef}
                className={[styles.dropzone, dragActive && styles.dropzoneActive, uploading && styles.dropzoneUploading].filter(Boolean).join(" ")}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={(event) => void handleDrop(event)}
                tabIndex={0}
                role="button"
                aria-label="Upload a cover image"
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  tabIndex={-1}
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  onChange={(event) => void handleFileSelected(event)}
                  className={styles.fileInput}
                />
                {uploading ? (
                  <>
                    <p className={styles.dropzoneTitle}>Uploading…</p>
                    <p className={styles.dropzoneHint}>{progress !== null ? `${Math.round(progress * 100)}%` : "Hang tight."}</p>
                  </>
                ) : (
                  <>
                    <p className={styles.dropzoneTitle}>Drop the cover image here</p>
                    <p className={styles.dropzoneHint}>or</p>
                    <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                      Browse files
                    </Button>
                    <p className={styles.dropzoneMeta}>JPEG, PNG, WEBP, or AVIF — up to 20MB.</p>
                  </>
                )}
              </div>
              {hasImage && (
                <button type="button" className={styles.cancelReplace} onClick={() => setReplacingImage(false)}>
                  ← Keep current cover
                </button>
              )}
              {uploadError && (
                <p className={styles.errorBanner}>
                  {uploadError}{" "}
                  <button type="button" className={styles.dismissInlineError} onClick={clearUploadError}>
                    Dismiss
                  </button>
                </p>
              )}

              {assets.isLoading && <p className={styles.hint}>Loading available covers…</p>}
              {assets.data && assets.data.length === 0 && (
                <p className={styles.hint}>
                  No covers found under <code>public/images/steam</code> yet.
                </p>
              )}
              {assets.data && assets.data.length > 0 && (
                <div className={styles.assetList}>
                  {assets.data.map((asset) => (
                    <div key={asset.url} className={[styles.assetRow, imageUrl === asset.url && styles.assetRowSelected].filter(Boolean).join(" ")}>
                      <div className={styles.assetRowMain}>
                        <button
                          type="button"
                          className={styles.assetRowSelectButton}
                          onClick={() => {
                            setImageUrl(asset.url);
                            setReplacingImage(false);
                          }}
                        >
                          <ImageWithFallback src={asset.url} alt="" className={styles.assetRowThumb} loading="lazy" fallbackLabel={asset.name} compact />
                          {imageUrl === asset.url ? "✓ " : ""}
                          {asset.name}
                        </button>
                      </div>
                      <button
                        type="button"
                        className={styles.assetRowDelete}
                        aria-label={`Delete ${asset.name}`}
                        onClick={() => setPendingDeleteAsset({ url: asset.url, name: asset.name })}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div>
          <p className={styles.fieldLabel}>
            Steam ratings {hasRatings && <span className={styles.fieldLabelOk}>✓</span>}
          </p>
          <p className={styles.hint}>Least obvious first — this is the exact order the Host reveals them in, one at a time.</p>
          <div className={styles.ratingsEditor}>
            {ratings.map((text, index) => (
              <div key={index} className={styles.ratingEditorRow}>
                <span className={styles.ratingEditorNumber}>{index + 1}</span>
                <textarea
                  className={styles.ratingEditorInput}
                  value={text}
                  onChange={(event) => updateRating(index, event.target.value)}
                  placeholder="Paste a Steam review…"
                  aria-label={`Rating ${index + 1}`}
                  rows={2}
                />
                <div className={styles.ratingEditorButtons}>
                  <button type="button" className={styles.ratingOrderButton} disabled={index === 0} onClick={() => moveRating(index, -1)} aria-label={`Move rating ${index + 1} up`}>
                    ↑
                  </button>
                  <button
                    type="button"
                    className={styles.ratingOrderButton}
                    disabled={index === ratings.length - 1}
                    onClick={() => moveRating(index, 1)}
                    aria-label={`Move rating ${index + 1} down`}
                  >
                    ↓
                  </button>
                  <button type="button" className={styles.ratingRemoveButton} onClick={() => removeRating(index)} aria-label={`Remove rating ${index + 1}`}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
          <Button type="button" variant="secondary" size="sm" disabled={ratings.length >= MAX_RATINGS} onClick={addRating}>
            + Add rating {ratings.length >= MAX_RATINGS ? `(max ${MAX_RATINGS})` : ""}
          </Button>
        </div>

        {updateGame.isError && <p className={styles.errorBanner}>Couldn&apos;t save this game. Please try again.</p>}
        {deleteAsset.isError && <p className={styles.errorBanner}>Couldn&apos;t remove that cover. Please try again.</p>}

        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <Button variant="ghost" size="sm" onClick={onRequestDelete}>
              Delete game
            </Button>
            <Button variant="ghost" size="sm" loading={duplicating} onClick={onDuplicate}>
              Duplicate
            </Button>
          </div>
          <div className={styles.footerRight}>
            <Button variant="secondary" loading={pendingMode === "stay"} disabled={updateGame.isPending && pendingMode !== "stay"} onClick={() => save("stay")}>
              Save
            </Button>
            <div className={styles.saveNextGroup}>
              <Button loading={pendingMode === "next"} disabled={updateGame.isPending && pendingMode !== "next"} onClick={() => save("next")}>
                Save & Next Game →
              </Button>
              {!hasNextGame && <span className={styles.saveNextHint}>Creates Game {String(gameNumber + 1).padStart(2, "0")}</span>}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeleteAsset !== null}
        title="Remove this cover?"
        description={
          pendingDeleteAsset
            ? `"${pendingDeleteAsset.name}" will be removed from the shared pool. Any game still pointing at it will lose its cover.`
            : undefined
        }
        confirmLabel="Remove"
        danger
        confirming={deleteAsset.isPending}
        onCancel={() => setPendingDeleteAsset(null)}
        onConfirm={handleDeleteAsset}
      />
    </div>
  );
}
