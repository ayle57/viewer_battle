"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, ClickableImageMap, ConfirmDialog, Input, type MapMarker } from "@/ui";
import { SaveStatus, type SaveState } from "../../../_shared/SaveStatus";
import { useGeoAssetUpload } from "./useGeoAssetUpload";
import styles from "./RoundEditorPanel.module.css";

export interface RoundEditorPanelRound {
  id: string;
  title: string | null;
  question: string | null;
  imageUrl: string | null;
  targetX: number | null;
  targetY: number | null;
}

export interface RoundEditorPanelProps {
  token: string;
  playlistId: string;
  round: RoundEditorPanelRound;
  roundNumber: number;
  /** Whether the sidebar already has a round after this one — decides what "Save & Next Round" actually does (jump to it vs. create a fresh one), computed by the parent (it owns the full round list, this panel only knows about ONE round). */
  hasNextRound: boolean;
  onSaved: (mode: "stay" | "next") => void;
  onDuplicate: () => void;
  /**
   * Whether the PARENT's duplicate mutation is currently in flight — the
   * mutation itself lives one level up (page.tsx owns it, same as
   * `onRequestDelete`'s deletion), so this panel can't derive its own
   * pending state. A real, reproduced bug (found via a real browser, not
   * a code read): double-clicking "Duplicate" before this existed fired
   * TWO duplicate mutations (no guard at all, unlike Save — which already
   * disables itself via its own `updateRound.isPending` — and Delete,
   * which goes through `ConfirmDialog`'s own `confirming` guard), quietly
   * leaving an extra, unwanted round behind.
   */
  duplicating: boolean;
  onRequestDelete: () => void;
  onPreview: () => void;
  /**
   * Reports whether this round's LOCAL buffer (title/question/image/
   * target) currently differs from what's actually saved — the parent
   * owns every action that would remount this panel with a DIFFERENT
   * round (sidebar clicks, +Add Round, Duplicate — see page.tsx's
   * `guardedSwitch`), so it's the one place that can actually warn
   * before silently discarding an edit. A real, reproduced bug (found
   * via a real browser, not a code read): switching rounds without
   * saving lost the edit with ZERO warning, since `key={round.id}` at
   * the call site fully remounts this panel — the local buffer was
   * simply gone. Not called on every keystroke, only when the boolean
   * itself flips (see the effect below).
   */
  onDirtyChange: (dirty: boolean) => void;
}

/**
 * "Missing:" list order, matching the on-screen field order top to
 * bottom (Question -> Map -> Correct location, see the `.form` JSX
 * below) — the NEXT STEP hint always points at whichever gap is
 * physically CLOSEST to the top of the page, so following it never
 * means scrolling past an already-fixed field to reach the real one.
 * Every input here is one of the same three booleans the READY badge
 * itself is computed from (`hasQuestion`/`hasImage`/`hasTarget`) — no
 * second readiness concept, just three different renderings of it.
 */
function missingSteps(hasQuestion: boolean, hasImage: boolean, hasTarget: boolean): string[] {
  const missing: string[] = [];
  if (!hasQuestion) missing.push("Question");
  if (!hasImage) missing.push("Map");
  if (!hasTarget) missing.push("Correct location");
  return missing;
}

const NEXT_STEP_COPY: Record<string, string> = {
  Question: "Add a question.",
  Map: "Upload a map.",
  "Correct location": "Set the correct location on the map.",
};

/**
 * The round editor's MAIN panel — item 3's redesign: no longer a modal
 * (`RoundEditorDialog`, retired by an earlier pass), a persistent panel
 * next to the round SIDEBAR (../[id]/page.tsx) so switching which round
 * is being edited is one click, not close-dialog-then-reopen. `key={
 * round.id}` at the call site is what resets this panel's local buffer
 * state on a round switch — same net effect as the render-phase-reset
 * pattern used elsewhere in this app, simpler here because a full
 * remount is exactly what "editing a different round" already wants (no
 * state worth carrying across the switch) — it's also what makes the
 * autofocus effect below correctly re-run on every round switch, not
 * just the panel's first-ever mount.
 *
 * Image selection reads content.geoAsset.list (src/server/content/
 * geoAssets.ts) — whatever's actually on disk under public/images/maps,
 * never a hardcoded list — plus drag & drop / browse upload that POSTs
 * straight to src/app/api/content/geo-assets/route.ts (gated behind this
 * same `token`, i.e. the streamer only) and adds the result to that same
 * pool, selected immediately.
 */
export function RoundEditorPanel({ token, playlistId, round, roundNumber, hasNextRound, onSaved, onDuplicate, duplicating, onRequestDelete, onPreview, onDirtyChange }: RoundEditorPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const utils = trpc.useUtils();
  const assets = trpc.content.geoAsset.list.useQuery();
  const updateRound = trpc.content.geoRound.update.useMutation();
  const deleteAsset = trpc.content.geoAsset.delete.useMutation();
  const { upload, uploading, progress, error: uploadError, clearError: clearUploadError } = useGeoAssetUpload(token);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The dropzone ITSELF, not the "Browse files" Button inside it — Button
  // (src/ui/primitives/Button) isn't `forwardRef`, so it can't take a ref
  // directly. Made tabbable/keyboard-activatable below (`tabIndex={0}`,
  // `role="button"`, Enter/Space opens the file picker) specifically so
  // this ref is a REAL, visible focus target, not a workaround that
  // quietly does nothing.
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  const [title, setTitle] = useState(round.title ?? "");
  const [question, setQuestion] = useState(round.question ?? "");
  const [imageUrl, setImageUrl] = useState(round.imageUrl ?? "");
  // Present -> the dropzone/asset-picker is showing even though an image
  // is already chosen (the Host clicked "Replace") — see the Map section
  // below. Starts true whenever there's no image yet, since there's
  // nothing to preview instead.
  const [replacingImage, setReplacingImage] = useState(!round.imageUrl);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState<{ url: string; name: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [target, setTarget] = useState<{ x: number; y: number } | null>(
    round.targetX !== null && round.targetY !== null ? { x: round.targetX, y: round.targetY } : null,
  );
  // Which of the two save buttons is in flight — drives which one shows
  // its own loading state without the other one also spinning.
  const [pendingMode, setPendingMode] = useState<"stay" | "next" | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // What's ACTUALLY saved right now — captured at mount (this panel's
  // own initial buffer, matching `round` exactly then) and updated only
  // by a successful Save below, never by every keystroke. State, not a
  // ref: `isDirty` below reads it during render, and the `react-hooks/
  // refs` rule correctly forbids reading `ref.current` there (it can't
  // guarantee a re-render when the ref changes). Comparing the live
  // buffer against THIS (not the `round` prop) is what makes `isDirty`
  // correct the instant Save succeeds, rather than staying (briefly,
  // wrongly) "dirty" until the parent's own `invalidate()` round-trip
  // catches the `round` prop up to match — a real race that would
  // otherwise pop an unnecessary "discard changes?" dialog if a Host
  // switched rounds in that exact window.
  const [savedSnapshot, setSavedSnapshot] = useState({ title: round.title ?? "", question: round.question ?? "", imageUrl: round.imageUrl ?? "", target });
  const isDirty =
    title !== savedSnapshot.title ||
    question !== savedSnapshot.question ||
    imageUrl !== savedSnapshot.imageUrl ||
    target?.x !== savedSnapshot.target?.x ||
    target?.y !== savedSnapshot.target?.y;

  // Only reports UP when the boolean itself actually flips — the parent
  // only needs to know "is there something to lose," not every
  // keystroke. `onDirtyChange` is a stable callback (see page.tsx), so
  // this isn't re-subscribing on every render either.
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);
  // The parent owns every navigation-away action; THIS unmounting (a
  // real round switch, `key={round.id}`) is the one moment guaranteed to
  // follow a dirty check the parent already made — clear the flag so a
  // stale "dirty" from this round never bleeds into whatever's selected
  // next before its own first effect run.
  useEffect(() => () => onDirtyChange(false), []); // eslint-disable-line react-hooks/exhaustive-deps -- deliberately only on unmount, not tied to onDirtyChange identity

  const hasImage = Boolean(imageUrl);
  const hasQuestion = Boolean(question.trim());
  const hasTarget = target !== null;
  const ready = hasImage && hasQuestion && hasTarget;
  const missing = missingSteps(hasQuestion, hasImage, hasTarget);

  // Item 9's keyboard flow: land on whichever field actually needs
  // attention first, the SAME priority the "NEXT STEP" hint below uses —
  // one field earns focus, not a tab-order guess. Nothing to focus for a
  // missing target (placing one is a map click, not a keyboard field),
  // and an already-READY round doesn't steal focus from anything.
  useEffect(() => {
    if (!hasQuestion) questionRef.current?.focus();
    else if (!hasImage) dropzoneRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once per mount (a round switch, via `key={round.id}` at the call site), not on every keystroke that changes hasQuestion/hasImage
  }, []);

  function save(mode: "stay" | "next") {
    setPendingMode(mode);
    setSaveState("saving");
    updateRound.mutate(
      {
        token,
        roundId: round.id,
        title: title.trim() || null,
        question: question.trim() || null,
        imageUrl: imageUrl || null,
        targetX: target?.x ?? null,
        targetY: target?.y ?? null,
      },
      {
        onSuccess: () => {
          void utils.content.geoPlaylist.get.invalidate({ token, playlistId });
          // The buffer just saved IS the new "clean" baseline — updating
          // this here, not from the `round` prop once it eventually
          // catches up via the invalidate() above, is what keeps
          // `isDirty` accurate immediately rather than staying
          // (wrongly) true for that round-trip.
          setSavedSnapshot({ title, question, imageUrl, target });
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

  // Cmd/Ctrl+Enter -> the same primary action the button itself performs
  // (Save & Next, not a plain Save) — the one shortcut worth having for
  // someone heads-down preparing a dozen rounds; deliberately not a
  // bigger shortcut system (item 9's own "don't build a huge shortcut
  // system"). Scoped to this panel's own root, not a global `window`
  // listener, so it never fires while focus is somewhere else entirely
  // (a sidebar round-list item, the playlist name field one level up).
  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save("next");
    }
  }

  async function handleFile(file: File) {
    const asset = await upload(file);
    if (!asset) return; // useGeoAssetUpload already recorded the error
    void utils.content.geoAsset.list.invalidate();
    setImageUrl(asset.url); // uploading a map is choosing it — no separate "now pick it from the grid" step
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
    // Only the REAL exit — a dragenter/dragleave pair fires for every
    // child element too as the pointer crosses their edges internally,
    // which would otherwise flicker the highlight off and back on while
    // dragging around inside the same dropzone. `relatedTarget` (where
    // the pointer is headed) still being inside `currentTarget` (this
    // dropzone) means it's an internal move, not a genuine leave.
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
          void utils.content.geoAsset.list.invalidate();
          // A round mid-edit that had this exact image selected loses it
          // too — keeping a phantom selection pointing at a file that no
          // longer exists would silently show a broken map on Save.
          if (imageUrl === pendingDeleteAsset.url) {
            setImageUrl("");
            setReplacingImage(true);
          }
          setPendingDeleteAsset(null);
        },
      },
    );
  }

  const markers: MapMarker[] = target ? [{ id: "target", x: target.x, y: target.y, color: "target", label: "TARGET" }] : [];

  return (
    <div className={styles.panel} onKeyDown={handlePanelKeyDown}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.roundEyebrow}>ROUND {String(roundNumber).padStart(2, "0")}</p>
          <h2 className={styles.roundTitle}>{title.trim() || "Untitled round"}</h2>
        </div>
        <div className={styles.headerRight}>
          <SaveStatus state={saveState} />
          {/* `key={ready}` remounts the badge on a genuine READY flip (not
              on every keystroke otherwise) — that's what makes the pop
              replay exactly once per real transition, warning->success or
              back, instead of firing on unrelated re-renders. */}
          <motion.span key={ready ? "ready" : "not-ready"} initial="hidden" animate="show" variants={popIn(reduced)}>
            <Badge variant={ready ? "success" : "warning"} dot>
              {ready ? "✓ READY" : "⚠ NOT READY"}
            </Badge>
          </motion.span>
        </div>
      </div>

      {/* One consolidated readiness block instead of scattered gray hint
          text under every field (item 2's own "évite les petits textes
          gris partout") — READY gets a single confident line; NOT READY
          gets exactly what's missing AND the one next action, both
          derived from the same three booleans the badge above uses. */}
      <div className={[styles.readinessPanel, ready ? styles.readinessPanelOk : styles.readinessPanelWarn].join(" ")}>
        {ready ? (
          <p className={styles.readinessLine}>Everything is set for this round.</p>
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
            Question / prompt {hasQuestion && <span className={styles.fieldLabelOk}>✓</span>}
          </p>
          {/* `aria-label`, not just the visually-adjacent `<p>` above — a
              real, reproduced gap (found via a real browser, not a code
              read): that `<p>` was never actually a `<label htmlFor>`
              wired to this field, so a screen reader had no programmatic
              way to know what this textarea was for at all. */}
          <textarea
            ref={questionRef}
            className={styles.textarea}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. Where is the above-ground Raiders Hatch?"
            rows={3}
            aria-label="Question / prompt"
          />
          <p className={styles.hint}>Shown to both teams for the whole round — what they&apos;re actually asked to find.</p>
        </div>

        <div>
          <p className={styles.fieldLabel}>
            Map {hasImage && <span className={styles.fieldLabelOk}>✓</span>}
          </p>

          {/* An image is already chosen and the Host isn't actively
              replacing it -> a real, large preview (`object-fit: contain`
              — see .mapPreviewImage, never cropped/stretched) is what
              proves "yes, this is the right map," not a small thumbnail
              buried among metadata. */}
          {hasImage && !replacingImage ? (
            <motion.div className={styles.mapPreview} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 8, duration: 0.35 })}>
              {/* eslint-disable-next-line @next/next/no-img-element -- same deliberate plain-<img> choice as ClickableImageMap */}
              <img src={imageUrl} alt={title || "Round map"} className={styles.mapPreviewImage} />
              <div className={styles.mapPreviewActions}>
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
                aria-label="Upload a map"
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
                    <p className={styles.dropzoneTitle}>Drop your map here</p>
                    <p className={styles.dropzoneHint}>or</p>
                    <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                      Browse files
                    </Button>
                    <p className={styles.dropzoneMeta}>PNG, JPG, WEBP, or AVIF — up to 100MB.</p>
                  </>
                )}
              </div>
              {hasImage && (
                <button type="button" className={styles.cancelReplace} onClick={() => setReplacingImage(false)}>
                  ← Keep current map
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

              {assets.isLoading && <p className={styles.hint}>Loading available maps…</p>}
              {assets.data && assets.data.length === 0 && (
                <p className={styles.hint}>
                  No images found under <code>public/images/maps</code> yet.
                </p>
              )}
              {assets.data && assets.data.length > 0 && (
                <div className={styles.assetGrid}>
                  {assets.data.map((asset) => (
                    <div key={asset.url} className={styles.assetThumbWrap}>
                      <button
                        type="button"
                        className={[styles.assetThumb, imageUrl === asset.url && styles.assetThumbSelected].filter(Boolean).join(" ")}
                        onClick={() => {
                          setImageUrl(asset.url);
                          setReplacingImage(false);
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element -- a small picker thumbnail, same deliberate plain-<img> choice as ClickableImageMap */}
                        <img src={asset.url} alt={asset.name} className={styles.assetThumbImage} loading="lazy" />
                        <span className={styles.assetThumbOverlay}>
                          <span className={styles.assetThumbName}>{asset.name}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className={styles.assetThumbDelete}
                        aria-label={`Delete ${asset.name}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          setPendingDeleteAsset({ url: asset.url, name: asset.name });
                        }}
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
          <div className={styles.locationHeader}>
            <p className={styles.fieldLabel}>
              Correct location {hasTarget && <span className={styles.fieldLabelOk}>✓</span>}
            </p>
            {target && (
              <button type="button" className={styles.resetLocationButton} onClick={() => setTarget(null)}>
                Reset location
              </button>
            )}
          </div>
          <p className={styles.hint}>
            {target
              ? `Click again to move it. (${(target.x * 100).toFixed(1)}%, ${(target.y * 100).toFixed(1)}%)`
              : "Click anywhere on the map to place the answer."}
          </p>
          <ClickableImageMap
            imageUrl={imageUrl}
            alt={title || "Round map"}
            markers={markers}
            onPick={(x, y) => setTarget({ x, y })}
            empty={!imageUrl}
            emptyLabel="Choose an image above first"
          />
        </div>

        {/* Optional — the round title is editorial metadata (the round
            LIST's own label), never part of readiness; kept last and
            visually quiet on purpose so it doesn't compete with the three
            fields that actually decide READY. */}
        <Input label="Round title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Dam Battlegrounds" />

        {updateRound.isError && <p className={styles.errorBanner}>Couldn&apos;t save this round. Please try again.</p>}
        {deleteAsset.isError && <p className={styles.errorBanner}>Couldn&apos;t remove that map. Please try again.</p>}

        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <Button variant="ghost" size="sm" onClick={onRequestDelete}>
              Delete round
            </Button>
            <Button variant="ghost" size="sm" loading={duplicating} onClick={onDuplicate}>
              Duplicate
            </Button>
            <Button variant="ghost" size="sm" onClick={onPreview}>
              Preview round
            </Button>
          </div>
          <div className={styles.footerRight}>
            <Button variant="secondary" loading={pendingMode === "stay"} disabled={updateRound.isPending && pendingMode !== "stay"} onClick={() => save("stay")}>
              Save
            </Button>
            <div className={styles.saveNextGroup}>
              <Button loading={pendingMode === "next"} disabled={updateRound.isPending && pendingMode !== "next"} onClick={() => save("next")}>
                Save & Next Round →
              </Button>
              {!hasNextRound && <span className={styles.saveNextHint}>Creates Round {String(roundNumber + 1).padStart(2, "0")}</span>}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeleteAsset !== null}
        title="Remove this map?"
        description={
          pendingDeleteAsset
            ? `"${pendingDeleteAsset.name}" will be removed from the shared pool. Any round still pointing at it will show a broken map.`
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
