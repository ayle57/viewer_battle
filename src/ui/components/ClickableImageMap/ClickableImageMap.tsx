"use client";

import { useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import styles from "./ClickableImageMap.module.css";

export type MapMarkerColor = "teamA" | "teamB" | "target" | "neutral";

export interface MapMarker {
  id: string;
  /** Normalized 0..1 — see src/domain/game/geoGuessr/types.ts's top comment on why every coordinate in this app's GeoGuessr feature is normalized, never an absolute pixel. */
  x: number;
  y: number;
  color: MapMarkerColor;
  label?: string;
  /** A slow breathing highlight — "this is the one you're currently placing," not a permanent style. */
  pulse?: boolean;
}

export interface MapLine {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
  color: MapMarkerColor;
}

export interface ClickableImageMapProps {
  imageUrl: string;
  alt: string;
  markers?: MapMarker[];
  lines?: MapLine[];
  /** Present -> the map is interactive (click/tap to place); absent -> pure display (Display panel, a locked player, the Host's read-only view). Click-to-place, not drag — see this component's own doc comment. */
  onPick?: (x: number, y: number) => void;
  disabled?: boolean;
  /** A neutral placeholder frame with no image loaded yet — the Content Studio round editor's "no image chosen" state. */
  empty?: boolean;
  emptyLabel?: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;

/**
 * The one shared "click on the map" primitive — used identically by the
 * Content Studio round editor (setting a round's target) and the Player's
 * guess UI (placing/locking a guess), so the coordinate math and the
 * click-precision guarantee only exist in one place. Click/tap to place,
 * not drag: the product brief explicitly asks for whichever is more
 * reliable on mobile/tablet, and a single pointerdown->coordinate
 * computation has no drag-cancel/drag-out-of-bounds edge cases to get
 * wrong on a touchscreen.
 *
 * Renders a plain `<img>` (not `next/image`) sized via `width: 100%;
 * height: auto` — the browser sizes that box to the image's OWN intrinsic
 * aspect ratio with zero letterboxing, which is what makes the click math
 * exact: `x = (clientX - rect.left) / rect.width` against the image
 * element's own `getBoundingClientRect()` is guaranteed to land exactly
 * on the visible pixel clicked, for any image's aspect ratio, without
 * this component needing to know that ratio ahead of time. The tradeoff
 * (documented, not silently accepted): a plain `<img>` gets no automatic
 * server-side resize/optimization, so a very large source file (the demo
 * map under public/images/maps is 16384x16384px, ~37MB) ships at full
 * resolution to every client. A real fix (next/image, or a proper
 * upload/resize pipeline) is a real follow-up, not done in this pass —
 * see the final report this shipped with.
 *
 * Zoom (interactive contexts only — wherever `onPick` is provided, so
 * both the round editor's target picker AND the player's guess map get
 * it, precision matters equally to both): `.frame` itself grows to
 * `zoom * 100%` of a fixed-size `.viewport` wrapper, which is what's
 * `overflow: auto` — the browser's OWN scrollbars/touch-drag pan around
 * it, no custom drag-tracking code needed. The click-math above still
 * works completely unchanged at any zoom level: `containerRef` measures
 * `.frame`'s CURRENT (possibly zoomed) `getBoundingClientRect()`, which
 * already reflects its true on-screen size and scroll position — the
 * formula never needed to know about zoom at all. Percent-based marker
 * positions (`left: X%`) stay correct for the same reason: percentages
 * resolve against `.frame`'s own box, which zoom resizes together with
 * the image, never against the outer fixed-size viewport.
 */
export function ClickableImageMap({ imageUrl, alt, markers = [], lines = [], onPick, disabled = false, empty = false, emptyLabel }: ClickableImageMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);

  // Render-phase reset (React's blessed "adjusting state when a prop
  // changes" pattern, same shape used elsewhere in this app — e.g.
  // DisplayGeoPanel's reveal-stage reset) — a fresh image starts at
  // MIN_ZOOM instead of inheriting whatever zoom level the PREVIOUS
  // image was left at.
  const [zoomedFor, setZoomedFor] = useState(imageUrl);
  let effectiveZoom = zoom;
  if (zoomedFor !== imageUrl) {
    setZoomedFor(imageUrl);
    effectiveZoom = MIN_ZOOM;
    setZoom(MIN_ZOOM);
  }

  const allowZoom = Boolean(onPick) && !disabled && !empty;
  const isZoomedIn = effectiveZoom > MIN_ZOOM;

  // `onClick`, not `onPointerDown` — a real behavior change from before
  // zoom existed. Once zoomed, `.frame` overflows `.viewport` and panning
  // it is a genuine drag/scroll gesture; `onPointerDown` fires the
  // instant a finger/mouse goes down, before the browser knows whether
  // this touch will turn into a pan, which misfired a placement on every
  // pan attempt. `click` doesn't fire at all if the pointer moved
  // meaningfully between down and up (the browser's own tap-vs-drag
  // distinction), which is exactly "place on a genuine tap, pan on a
  // drag" for free, at zoom 1 or any other level.
  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!onPick || disabled || empty) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    onPick(x, y);
  }

  if (empty) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>{emptyLabel ?? "No image chosen yet"}</p>
      </div>
    );
  }

  return (
    <div className={styles.viewport}>
      <div
        ref={containerRef}
        className={[styles.frame, onPick && !disabled && styles.interactive, isZoomedIn && styles.frameZoomed].filter(Boolean).join(" ")}
        style={{ width: `${effectiveZoom * 100}%` }}
        onClick={handleClick}
        role={onPick ? "button" : undefined}
        aria-label={onPick ? "Click the map to place your guess" : undefined}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- see this component's doc comment on why a plain <img>, not next/image, is the deliberate choice here */}
        <img src={imageUrl} alt={alt} className={styles.image} draggable={false} loading="lazy" decoding="async" />

        {lines.length > 0 && (
          <svg className={styles.lineLayer} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {lines.map((line) => (
              <line
                key={line.id}
                x1={line.from.x * 100}
                y1={line.from.y * 100}
                x2={line.to.x * 100}
                y2={line.to.y * 100}
                className={[styles.line, styles[`line_${line.color}`]].join(" ")}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </svg>
        )}

        {markers.map((marker) => (
          <span
            key={marker.id}
            className={[styles.marker, styles[`marker_${marker.color}`], marker.pulse && styles.markerPulse].filter(Boolean).join(" ")}
            style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
          >
            <span className={styles.markerDot} aria-hidden="true" />
            {marker.label && <span className={styles.markerLabel}>{marker.label}</span>}
          </span>
        ))}
      </div>

      {allowZoom && (
        <div className={styles.zoomControls} role="group" aria-label="Zoom">
          <button type="button" className={styles.zoomButton} disabled={effectiveZoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))} aria-label="Zoom out">
            −
          </button>
          <span className={styles.zoomLevel}>{Math.round(effectiveZoom * 100)}%</span>
          <button type="button" className={styles.zoomButton} disabled={effectiveZoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))} aria-label="Zoom in">
            +
          </button>
          {effectiveZoom > MIN_ZOOM && (
            <button type="button" className={styles.zoomReset} onClick={() => setZoom(MIN_ZOOM)}>
              Reset
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
