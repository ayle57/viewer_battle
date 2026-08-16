"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { trpc } from "@/app/_trpc/client";
import { Button, ClickableImageMap, Dialog, Input, type MapMarker } from "@/ui";
import { useGeoAssetUpload } from "./useGeoAssetUpload";
import styles from "./RoundEditorDialog.module.css";

export interface RoundEditorDialogProps {
  token: string;
  playlistId: string;
  round: { id: string; title: string | null; question: string | null; imageUrl: string | null; targetX: number | null; targetY: number | null };
  onClose: () => void;
}

/**
 * The round editor — "he picks the image, clicks the map to set the
 * correct location, a marker appears, he can move it before saving"
 * (product brief). Local `imageUrl`/`target` state until Save, mirroring
 * QuestionEditorDialog's own "edit in a buffer, commit on demand"
 * pattern — this dialog doesn't autosave every click the way the board
 * editor's inline fields do, because a stray click shouldn't silently
 * relocate a round's target with no undo.
 *
 * Image selection reads content.geoAsset.list (src/server/content/
 * geoAssets.ts) — whatever's actually on disk under public/images/maps,
 * never a hardcoded list — plus an "Upload your own map" control that
 * POSTs straight to src/app/api/content/geo-assets/route.ts (gated
 * behind this same `token`, i.e. the streamer only) and adds the result
 * to that same pool, selected immediately.
 */
export function RoundEditorDialog({ token, playlistId, round, onClose }: RoundEditorDialogProps) {
  const utils = trpc.useUtils();
  const assets = trpc.content.geoAsset.list.useQuery();
  const updateRound = trpc.content.geoRound.update.useMutation();
  const { upload, uploading, progress, error: uploadError, clearError: clearUploadError } = useGeoAssetUpload(token);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState(round.title ?? "");
  const [question, setQuestion] = useState(round.question ?? "");
  const [imageUrl, setImageUrl] = useState(round.imageUrl ?? "");
  const [target, setTarget] = useState<{ x: number; y: number } | null>(
    round.targetX !== null && round.targetY !== null ? { x: round.targetX, y: round.targetY } : null,
  );

  function handleSave() {
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
          onClose();
        },
      },
    );
  }

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets picking the SAME file again re-fire onChange
    if (!file) return;
    const asset = await upload(file);
    if (!asset) return; // useGeoAssetUpload already recorded the error
    void utils.content.geoAsset.list.invalidate();
    setImageUrl(asset.url); // uploading a map is choosing it — no separate "now pick it from the grid" step
  }

  const markers: MapMarker[] = target ? [{ id: "target", x: target.x, y: target.y, color: "target", label: "TARGET" }] : [];

  return (
    <Dialog open onClose={onClose} title="Edit round" description="Click the map to set the correct location." size="lg">
      <div className={styles.layout}>
        <div className={styles.form}>
          <Input label="Round title (optional)" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Dam Battlegrounds" />

          <Input
            label="Question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="e.g. Where is the docking bay?"
          />
          <p className={styles.hint}>Shown to both teams for the whole round — what they&apos;re actually asked to find.</p>

          <div>
            <p className={styles.fieldLabel}>Image</p>

            <div className={styles.uploadRow}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                onChange={(event) => void handleFileSelected(event)}
                className={styles.fileInput}
              />
              <Button type="button" variant="secondary" size="sm" loading={uploading} onClick={() => fileInputRef.current?.click()}>
                {uploading ? "Uploading…" : "Upload your own map"}
              </Button>
              {uploading && progress !== null && <span className={styles.uploadProgress}>{Math.round(progress * 100)}%</span>}
              <span className={styles.hint}>Full quality, up to 100MB — JPEG, PNG, WEBP, or AVIF.</span>
            </div>
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
                  <button
                    key={asset.url}
                    type="button"
                    className={[styles.assetThumb, imageUrl === asset.url && styles.assetThumbSelected].filter(Boolean).join(" ")}
                    onClick={() => setImageUrl(asset.url)}
                    title={asset.name}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- a small picker thumbnail, same deliberate plain-<img> choice as ClickableImageMap */}
                    <img src={asset.url} alt={asset.name} className={styles.assetThumbImage} loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className={styles.fieldLabel}>Correct location</p>
            <p className={styles.hint}>Click the map to set the target. {target ? `(${(target.x * 100).toFixed(1)}%, ${(target.y * 100).toFixed(1)}%)` : "Not set yet."}</p>
            <ClickableImageMap
              imageUrl={imageUrl}
              alt={title || "Round map"}
              markers={markers}
              onPick={(x, y) => setTarget({ x, y })}
              empty={!imageUrl}
              emptyLabel="Choose an image above first"
            />
          </div>

          {updateRound.isError && <p className={styles.errorBanner}>{updateRound.error.message}</p>}

          <div className={styles.footer}>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button loading={updateRound.isPending} onClick={handleSave}>
              Save Round
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
