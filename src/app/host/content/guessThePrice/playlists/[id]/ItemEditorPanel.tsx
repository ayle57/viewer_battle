"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, ConfirmDialog, ImageWithFallback, Input } from "@/ui";
import { SaveStatus, type SaveState } from "../../../_shared/SaveStatus";
import { usePriceAssetUpload } from "./usePriceAssetUpload";
import styles from "./ItemEditorPanel.module.css";

export interface ItemEditorPanelItem {
  id: string;
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  marginPercent: number | null;
}

export interface ItemEditorPanelProps {
  token: string;
  playlistId: string;
  item: ItemEditorPanelItem;
  itemNumber: number;
  /** Whether the sidebar already has an item after this one — decides what "Save & Next Item" actually does (jump to it vs. create a fresh one), computed by the parent, same shape as SteamRatings' own GameEditorPanel. */
  hasNextItem: boolean;
  onSaved: (mode: "stay" | "next") => void;
  onDuplicate: () => void;
  duplicating: boolean;
  onRequestDelete: () => void;
  /**
   * Reports whether this item's LOCAL buffer currently differs from
   * what's actually saved — same "own panel, own dirty state" contract
   * as every other game's own editor panel in this app.
   */
  onDirtyChange: (dirty: boolean) => void;
}

/** "Missing:" list order, matching the on-screen field order top to bottom (Title -> Photo -> Price) — same "next step always points at the closest gap" reasoning as GeoGuessr's own missingSteps. */
function missingSteps(hasTitle: boolean, hasImage: boolean, hasPrice: boolean): string[] {
  const missing: string[] = [];
  if (!hasTitle) missing.push("Title");
  if (!hasImage) missing.push("Photo");
  if (!hasPrice) missing.push("Price");
  return missing;
}

const NEXT_STEP_COPY: Record<string, string> = {
  Title: "Give this item a name — what everyone sees while they're guessing.",
  Photo: "Upload or pick a photo, shown to everyone the instant this round starts.",
  Price: "Set the real price — what the Host judges an oral guess against.",
};

/**
 * The item editor's MAIN panel — same "persistent sidebar next to one
 * main panel" shape as SteamRatingsEngine's own GameEditorPanel, adapted
 * for this game's own content shape (title + photo + price + an
 * OPTIONAL margin, no ordered ratings array). `key={item.id}` at the
 * call site resets this panel's local buffer on an item switch, same
 * reasoning as that component's own doc comment.
 *
 * Photo selection reads content.priceAsset.list (src/server/content/
 * priceAssets.ts) — whatever's actually on disk under public/images/
 * price, never a hardcoded list — plus drag & drop / browse upload that
 * POSTs straight to src/app/api/content/price-assets/route.ts (gated
 * behind this same `token`) and adds the result to that same pool,
 * selected immediately.
 *
 * `price`/`marginPercent` are genuinely new fields, not shared with any
 * other game's editor: plain numeric inputs, `marginPercent` explicitly
 * OPTIONAL — "il faut qu'il puisse mettre la marge de prix seul si il
 * veut en mettre une" — left blank by default and never counted toward
 * this item's own readiness (see itemSidebarState in the parent page).
 */
export function ItemEditorPanel({ token, playlistId, item, itemNumber, hasNextItem, onSaved, onDuplicate, duplicating, onRequestDelete, onDirtyChange }: ItemEditorPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const utils = trpc.useUtils();
  const assets = trpc.content.priceAsset.list.useQuery();
  const updateItem = trpc.content.priceItem.update.useMutation();
  const deleteAsset = trpc.content.priceAsset.delete.useMutation();
  const { upload, uploading, progress, error: uploadError, clearError: clearUploadError } = usePriceAssetUpload(token);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState(item.title ?? "");
  const [imageUrl, setImageUrl] = useState(item.imageUrl ?? "");
  const [price, setPrice] = useState(item.price !== null ? String(item.price) : "");
  const [marginPercent, setMarginPercent] = useState(item.marginPercent !== null ? String(item.marginPercent) : "");
  // Present -> the dropzone/asset-picker is showing even though a photo
  // is already chosen (the Host clicked "Replace") — see the Photo
  // section below. Starts true whenever there's no photo yet.
  const [replacingImage, setReplacingImage] = useState(!item.imageUrl);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState<{ url: string; name: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pendingMode, setPendingMode] = useState<"stay" | "next" | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const parsedPrice = price.trim() === "" ? null : Number(price);
  const parsedMargin = marginPercent.trim() === "" ? null : Number(marginPercent);

  // What's ACTUALLY saved right now — same "own local baseline, not the
  // `item` prop" reasoning as GeoGuessr's own savedSnapshot.
  const [savedSnapshot, setSavedSnapshot] = useState({ title: item.title ?? "", imageUrl: item.imageUrl ?? "", price: item.price, marginPercent: item.marginPercent });
  const isDirty =
    title !== savedSnapshot.title ||
    imageUrl !== savedSnapshot.imageUrl ||
    parsedPrice !== savedSnapshot.price ||
    parsedMargin !== savedSnapshot.marginPercent;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), []); // eslint-disable-line react-hooks/exhaustive-deps -- deliberately only on unmount, not tied to onDirtyChange identity

  const hasImage = Boolean(imageUrl);
  const hasTitle = Boolean(title.trim());
  const hasPrice = parsedPrice !== null && !Number.isNaN(parsedPrice) && parsedPrice > 0;
  const ready = hasImage && hasTitle && hasPrice;
  const missing = missingSteps(hasTitle, hasImage, hasPrice);

  // Same "land on whichever field actually needs attention first"
  // priority as SteamRatingsEngine's own GameEditorPanel — the title
  // field's own share of this is just its plain `autoFocus` prop below.
  useEffect(() => {
    if (hasTitle && !hasImage) dropzoneRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once per mount (an item switch, via `key={item.id}` at the call site)
  }, []);

  function save(mode: "stay" | "next") {
    setPendingMode(mode);
    setSaveState("saving");
    updateItem.mutate(
      {
        token,
        itemId: item.id,
        title: title.trim() || null,
        imageUrl: imageUrl || null,
        price: hasPrice ? parsedPrice : null,
        marginPercent: parsedMargin !== null && !Number.isNaN(parsedMargin) ? parsedMargin : null,
      },
      {
        onSuccess: () => {
          void utils.content.pricePlaylist.get.invalidate({ token, playlistId });
          setSavedSnapshot({ title, imageUrl, price: hasPrice ? parsedPrice : null, marginPercent: parsedMargin !== null && !Number.isNaN(parsedMargin) ? parsedMargin : null });
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
    if (!asset) return; // usePriceAssetUpload already recorded the error
    void utils.content.priceAsset.list.invalidate();
    setImageUrl(asset.url); // uploading a photo is choosing it — no separate "now pick it from the list" step
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
          void utils.content.priceAsset.list.invalidate();
          // An item mid-edit that had this exact photo selected loses it
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

  return (
    <div className={styles.panel} onKeyDown={handlePanelKeyDown}>
      <div className={styles.header}>
        <div className={styles.headerText}>
          <p className={styles.roundEyebrow}>ITEM {String(itemNumber).padStart(2, "0")}</p>
          <h2 className={styles.roundTitle}>{title.trim() || "Untitled item"}</h2>
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
          <p className={styles.readinessLine}>Everything is set for this item.</p>
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
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Wireless Headphones" aria-label="Item title" autoFocus={!hasTitle} />
          <p className={styles.hint}>Public the instant this round starts — everyone sees this while they&apos;re guessing.</p>
        </div>

        <div>
          <p className={styles.fieldLabel}>
            Photo {hasImage && <span className={styles.fieldLabelOk}>✓</span>}
          </p>

          {hasImage && !replacingImage ? (
            <motion.div className={styles.imagePreview} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 8, duration: 0.35 })}>
              <ImageWithFallback src={imageUrl} alt="" className={styles.imagePreviewImg} fallbackLabel="Photo unavailable — try Replace" />
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
                aria-label="Upload a photo"
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
                    <p className={styles.dropzoneTitle}>Drop the photo here</p>
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
                  ← Keep current photo
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

              {assets.isLoading && <p className={styles.hint}>Loading available photos…</p>}
              {assets.data && assets.data.length === 0 && (
                <p className={styles.hint}>
                  No photos found under <code>public/images/price</code> yet.
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

        <div className={styles.priceRow}>
          <div>
            <p className={styles.fieldLabel}>
              Price {hasPrice && <span className={styles.fieldLabelOk}>✓</span>}
            </p>
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="49.99"
              aria-label="Item price"
            />
            <p className={styles.hint}>The reference answer — what the Host judges an oral guess against. Hidden until the round ends.</p>
          </div>

          <div>
            <p className={styles.fieldLabel}>Margin (optional)</p>
            <Input
              type="number"
              min="0"
              max="100"
              step="1"
              value={marginPercent}
              onChange={(event) => setMarginPercent(event.target.value)}
              placeholder="e.g. 10"
              aria-label="Judging margin percent"
            />
            <p className={styles.hint}>A &quot;close enough&quot; guideline shown only to you — leave it blank to judge purely by ear.</p>
          </div>
        </div>

        {updateItem.isError && <p className={styles.errorBanner}>Couldn&apos;t save this item. Please try again.</p>}
        {deleteAsset.isError && <p className={styles.errorBanner}>Couldn&apos;t remove that photo. Please try again.</p>}

        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <Button variant="ghost" size="sm" onClick={onRequestDelete}>
              Delete item
            </Button>
            <Button variant="ghost" size="sm" loading={duplicating} onClick={onDuplicate}>
              Duplicate
            </Button>
          </div>
          <div className={styles.footerRight}>
            <Button variant="secondary" loading={pendingMode === "stay"} disabled={updateItem.isPending && pendingMode !== "stay"} onClick={() => save("stay")}>
              Save
            </Button>
            <div className={styles.saveNextGroup}>
              <Button loading={pendingMode === "next"} disabled={updateItem.isPending && pendingMode !== "next"} onClick={() => save("next")}>
                Save & Next Item →
              </Button>
              {!hasNextItem && <span className={styles.saveNextHint}>Creates Item {String(itemNumber + 1).padStart(2, "0")}</span>}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeleteAsset !== null}
        title="Remove this photo?"
        description={
          pendingDeleteAsset
            ? `"${pendingDeleteAsset.name}" will be removed from the shared pool. Any item still pointing at it will lose its photo.`
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
