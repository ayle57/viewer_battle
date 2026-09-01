"use client";

import { useState } from "react";
import styles from "./ImageWithFallback.module.css";

export interface ImageWithFallbackProps {
  src: string;
  alt: string;
  /** Applied to BOTH the real `<img>` and the fallback box — this is what actually sizes the thing (width/max-height/border-radius/object-fit come from the caller's own module CSS), `ImageWithFallback` only ever adds flex-centering + a muted icon on top when it's showing the fallback. */
  className?: string;
  loading?: "eager" | "lazy";
  /** Shown under the icon in the fallback state — defaults to something that reads fine whether the viewer is a Host looking at their own Content Studio or an audience watching Display. Always used for the `aria-label`/`role="img"` name even in `compact` mode, so the element stays meaningfully labeled for assistive tech regardless of how little visual room there is for the text. */
  fallbackLabel?: string;
  /** For a thumbnail too small to fit a label under the icon (an asset-picker row, a library card) — icon only, visually, but the accessible name (`aria-label`) still comes from `fallbackLabel`/`alt`. */
  compact?: boolean;
}

/**
 * A plain `<img>` that degrades to a small, on-brand placeholder instead
 * of the browser's own broken-image icon — the ONE thing every raw
 * `<img>` in this app (GuessThePrice/SteamRatings' item photos and
 * covers, their Content Studio editors' previews/asset thumbnails) was
 * missing until now. Matters most on Display (this file exists because
 * of that ask specifically): a live show's OBS overlay showing a stock
 * "broken image" glyph mid-stream reads as the app being broken, not as
 * "this one file is missing" — a real, reachable failure mode too, not a
 * hypothetical one: contentSteam.ts's `deleteSteamCoverAsset` / contentPrice.ts's
 * equivalent both explicitly do NOT check whether a still-in-use round
 * still references the file being removed from the shared pool (their
 * own doc comments disclose this), so a Host cleaning up old covers
 * mid-prep can absolutely orphan a reference a live game later snapshots.
 *
 * Deliberately still a plain `<img>` under the hood (`loading`/`decoding`
 * passed through, same posture as ClickableImageMap's own doc comment on
 * why this app never reaches for `next/image` on locally-uploaded,
 * arbitrarily-sized content) — this component only ever adds the
 * `onError` handling and the fallback render, nothing else about how the
 * image itself loads.
 *
 * Tracks the failure by comparing the FAILED src to the current `src`
 * (`useState<string | null>`, not a boolean) — a round/item change that
 * hands this component a brand-new `src` automatically clears a stale
 * failure with no extra reset effect needed; a broken image staying
 * broken across a re-render (same `src`) correctly stays in the fallback
 * state instead of retrying and flashing the browser's own broken-icon
 * for a frame first.
 */
export function ImageWithFallback({ src, alt, className, loading, fallbackLabel = "Image unavailable", compact = false }: ImageWithFallbackProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (failedSrc === src) {
    return (
      <div className={[styles.fallback, compact && styles.compact, className].filter(Boolean).join(" ")} role="img" aria-label={alt || fallbackLabel}>
        <span className={styles.fallbackIcon} aria-hidden="true">
          🖼️
        </span>
        {!compact && <span className={styles.fallbackLabel}>{fallbackLabel}</span>}
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element -- see this component's own doc comment on why a plain <img>, not next/image, is the deliberate choice throughout this app
  return <img src={src} alt={alt} className={className} loading={loading} decoding="async" onError={() => setFailedSrc(src)} />;
}
