"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { fadeUp, popIn } from "@/app/_shared/motion/variants";
import { trpc } from "@/app/_trpc/client";
import { Badge, Button, ConfirmDialog, Input } from "@/ui";
import { SaveStatus, type SaveState } from "../../../_shared/SaveStatus";
import { useMusicAssetUpload } from "./useMusicAssetUpload";
import styles from "./TrackEditorPanel.module.css";

export interface TrackEditorPanelTrack {
  id: string;
  title: string | null;
  artist: string | null;
  audioUrl: string | null;
}

export interface TrackEditorPanelProps {
  token: string;
  playlistId: string;
  track: TrackEditorPanelTrack;
  trackNumber: number;
  /** Whether the sidebar already has a track after this one — decides what "Save & Next Track" actually does (jump to it vs. create a fresh one), computed by the parent, same shape as GeoGuessr's own RoundEditorPanel. */
  hasNextTrack: boolean;
  onSaved: (mode: "stay" | "next") => void;
  onDuplicate: () => void;
  duplicating: boolean;
  onRequestDelete: () => void;
  /**
   * Reports whether this track's LOCAL buffer currently differs from
   * what's actually saved — same "own panel, own dirty state" contract
   * as GeoGuessr's own RoundEditorPanel.onDirtyChange (see that
   * component's doc comment for the real bug this prevents: switching
   * tracks without saving used to lose the edit with zero warning).
   */
  onDirtyChange: (dirty: boolean) => void;
}

/** "Missing:" list order, matching the on-screen field order top to bottom (Title -> Audio) — same "next step always points at the closest gap" reasoning as GeoGuessr's own missingSteps. */
function missingSteps(hasTitle: boolean, hasAudio: boolean): string[] {
  const missing: string[] = [];
  if (!hasTitle) missing.push("Title");
  if (!hasAudio) missing.push("Audio clip");
  return missing;
}

const NEXT_STEP_COPY: Record<string, string> = {
  Title: "Give this track a title — what the Host will judge answers against.",
  "Audio clip": "Upload or pick an audio clip.",
};

/**
 * The track editor's MAIN panel — same "persistent sidebar next to one
 * main panel" shape as GeoGuessr's own RoundEditorPanel
 * (../../geoguessr/playlists/[id]/RoundEditorPanel.tsx), adapted for
 * Music's own content shape (audio + title + optional artist, no
 * image/target/question). `key={track.id}` at the call site resets this
 * panel's local buffer on a track switch, same reasoning as that file's
 * own doc comment.
 *
 * Audio selection reads content.musicAsset.list (src/server/content/
 * musicAssets.ts) — whatever's actually on disk under public/audio/
 * music, never a hardcoded list — plus drag & drop / browse upload that
 * POSTs straight to src/app/api/content/music-assets/route.ts (gated
 * behind this same `token`) and adds the result to that same pool,
 * selected immediately.
 */
export function TrackEditorPanel({ token, playlistId, track, trackNumber, hasNextTrack, onSaved, onDuplicate, duplicating, onRequestDelete, onDirtyChange }: TrackEditorPanelProps) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment
  const utils = trpc.useUtils();
  const assets = trpc.content.musicAsset.list.useQuery();
  const updateTrack = trpc.content.musicTrack.update.useMutation();
  const deleteAsset = trpc.content.musicAsset.delete.useMutation();
  const { upload, uploading, progress, error: uploadError, clearError: clearUploadError } = useMusicAssetUpload(token);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropzoneRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState(track.title ?? "");
  const [artist, setArtist] = useState(track.artist ?? "");
  const [audioUrl, setAudioUrl] = useState(track.audioUrl ?? "");
  // Present -> the dropzone/asset-picker is showing even though a clip is
  // already chosen (the Host clicked "Replace") — see the Audio section
  // below. Starts true whenever there's no clip yet.
  const [replacingAudio, setReplacingAudio] = useState(!track.audioUrl);
  const [pendingDeleteAsset, setPendingDeleteAsset] = useState<{ url: string; name: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [pendingMode, setPendingMode] = useState<"stay" | "next" | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // What's ACTUALLY saved right now — same "own local baseline, not the
  // `track` prop" reasoning as GeoGuessr's own savedSnapshot.
  const [savedSnapshot, setSavedSnapshot] = useState({ title: track.title ?? "", artist: track.artist ?? "", audioUrl: track.audioUrl ?? "" });
  const isDirty = title !== savedSnapshot.title || artist !== savedSnapshot.artist || audioUrl !== savedSnapshot.audioUrl;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), []); // eslint-disable-line react-hooks/exhaustive-deps -- deliberately only on unmount, not tied to onDirtyChange identity

  const hasAudio = Boolean(audioUrl);
  const hasTitle = Boolean(title.trim());
  const ready = hasAudio && hasTitle;
  const missing = missingSteps(hasTitle, hasAudio);

  // Same "land on whichever field actually needs attention first"
  // priority as GeoGuessr's own RoundEditorPanel — the title field's own
  // share of this is just its plain `autoFocus` prop below (the `Input`
  // primitive isn't `forwardRef`, so it can't take a ref the way
  // GeoGuessr's raw `<textarea>` does); this effect only ever needs to
  // handle the SECOND-priority case, focusing the dropzone once title is
  // already filled in but audio still isn't.
  useEffect(() => {
    if (hasTitle && !hasAudio) dropzoneRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately once per mount (a track switch, via `key={track.id}` at the call site)
  }, []);

  function save(mode: "stay" | "next") {
    setPendingMode(mode);
    setSaveState("saving");
    updateTrack.mutate(
      {
        token,
        trackId: track.id,
        title: title.trim() || null,
        artist: artist.trim() || null,
        audioUrl: audioUrl || null,
      },
      {
        onSuccess: () => {
          void utils.content.musicPlaylist.get.invalidate({ token, playlistId });
          setSavedSnapshot({ title, artist, audioUrl });
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

  // Cmd/Ctrl+Enter -> Save & Next, same shortcut GeoGuessr's own
  // RoundEditorPanel offers, scoped to this panel's own root.
  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      save("next");
    }
  }

  async function handleFile(file: File) {
    const asset = await upload(file);
    if (!asset) return; // useMusicAssetUpload already recorded the error
    void utils.content.musicAsset.list.invalidate();
    setAudioUrl(asset.url); // uploading a clip is choosing it — no separate "now pick it from the list" step
    setReplacingAudio(false);
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
          void utils.content.musicAsset.list.invalidate();
          // A track mid-edit that had this exact clip selected loses it
          // too — keeping a phantom selection pointing at a file that no
          // longer exists would silently ship a broken clip on Save.
          if (audioUrl === pendingDeleteAsset.url) {
            setAudioUrl("");
            setReplacingAudio(true);
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
          <p className={styles.roundEyebrow}>TRACK {String(trackNumber).padStart(2, "0")}</p>
          <h2 className={styles.roundTitle}>{title.trim() || "Untitled track"}</h2>
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
          <p className={styles.readinessLine}>Everything is set for this track.</p>
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
          {/* Real <label> semantics via aria-label, not just a visually
              adjacent <p> — same fix GeoGuessr's own question textarea
              already applies. */}
          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Bohemian Rhapsody"
            aria-label="Track title"
            autoFocus={!hasTitle}
          />
          <p className={styles.hint}>The reference answer — what the Host judges a team&apos;s guess against. Revealed to everyone once the round ends.</p>
        </div>

        <div>
          <p className={styles.fieldLabel}>Artist (optional)</p>
          <Input value={artist} onChange={(event) => setArtist(event.target.value)} placeholder="e.g. Queen" aria-label="Track artist" />
          <p className={styles.hint}>Shown alongside the title on reveal — leave blank for a clip with no meaningful separate artist.</p>
        </div>

        <div>
          <p className={styles.fieldLabel}>
            Audio clip {hasAudio && <span className={styles.fieldLabelOk}>✓</span>}
          </p>

          {hasAudio && !replacingAudio ? (
            <motion.div className={styles.audioPreview} initial="hidden" animate="show" variants={fadeUp(reduced, { y: 8, duration: 0.35 })}>
              <audio className={styles.audioPlayer} src={audioUrl} controls preload="metadata" />
              <div className={styles.audioPreviewActions}>
                <Button type="button" variant="secondary" size="sm" onClick={() => setReplacingAudio(true)}>
                  Replace
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAudioUrl("");
                    setReplacingAudio(true);
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
                aria-label="Upload an audio clip"
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
                  accept="audio/mpeg,audio/wav,audio/x-wav,audio/wave,audio/ogg,audio/mp4,audio/x-m4a"
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
                    <p className={styles.dropzoneTitle}>Drop your clip here</p>
                    <p className={styles.dropzoneHint}>or</p>
                    <Button type="button" variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                      Browse files
                    </Button>
                    <p className={styles.dropzoneMeta}>MP3, WAV, OGG, or M4A — up to 25MB.</p>
                  </>
                )}
              </div>
              {hasAudio && (
                <button type="button" className={styles.cancelReplace} onClick={() => setReplacingAudio(false)}>
                  ← Keep current clip
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

              {assets.isLoading && <p className={styles.hint}>Loading available clips…</p>}
              {assets.data && assets.data.length === 0 && (
                <p className={styles.hint}>
                  No clips found under <code>public/audio/music</code> yet.
                </p>
              )}
              {assets.data && assets.data.length > 0 && (
                <div className={styles.assetList}>
                  {assets.data.map((asset) => (
                    <div key={asset.url} className={[styles.assetRow, audioUrl === asset.url && styles.assetRowSelected].filter(Boolean).join(" ")}>
                      <div className={styles.assetRowMain}>
                        <button
                          type="button"
                          className={styles.assetRowSelectButton}
                          onClick={() => {
                            setAudioUrl(asset.url);
                            setReplacingAudio(false);
                          }}
                        >
                          {audioUrl === asset.url ? "✓ " : ""}
                          {asset.name}
                        </button>
                        <audio className={styles.assetRowPlayer} src={asset.url} controls preload="none" />
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

        {updateTrack.isError && <p className={styles.errorBanner}>Couldn&apos;t save this track. Please try again.</p>}
        {deleteAsset.isError && <p className={styles.errorBanner}>Couldn&apos;t remove that clip. Please try again.</p>}

        <div className={styles.footer}>
          <div className={styles.footerLeft}>
            <Button variant="ghost" size="sm" onClick={onRequestDelete}>
              Delete track
            </Button>
            <Button variant="ghost" size="sm" loading={duplicating} onClick={onDuplicate}>
              Duplicate
            </Button>
          </div>
          <div className={styles.footerRight}>
            <Button variant="secondary" loading={pendingMode === "stay"} disabled={updateTrack.isPending && pendingMode !== "stay"} onClick={() => save("stay")}>
              Save
            </Button>
            <div className={styles.saveNextGroup}>
              <Button loading={pendingMode === "next"} disabled={updateTrack.isPending && pendingMode !== "next"} onClick={() => save("next")}>
                Save & Next Track →
              </Button>
              {!hasNextTrack && <span className={styles.saveNextHint}>Creates Track {String(trackNumber + 1).padStart(2, "0")}</span>}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeleteAsset !== null}
        title="Remove this clip?"
        description={
          pendingDeleteAsset
            ? `"${pendingDeleteAsset.name}" will be removed from the shared pool. Any track still pointing at it will lose its audio.`
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
