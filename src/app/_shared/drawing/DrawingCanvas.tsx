"use client";

import { useEffect, useRef } from "react";
import { getStroke } from "perfect-freehand";
import type { DrawingStroke } from "@/app/_shared/drawingStore";
import styles from "./DrawingCanvas.module.css";

export interface DrawingCanvasProps {
  /** Already-committed strokes to render — normalized [0,1] coordinates, resize-safe (same convention as GeoGuessr's targetX/targetY), so this canvas never needs to know its own pixel size to draw correctly. */
  strokes: DrawingStroke[];
  /** `true` for every viewer except the active drawer — no pointer capture, no strokes ever originate here. */
  readOnly?: boolean;
  /** The current pen color/width, only meaningful when `!readOnly`. */
  color?: string;
  width?: number;
  /** Fired once per completed stroke (pointerup), never per pointermove — see this file's own top comment on why strokes are batched, not point-by-point, before ever reaching the network. */
  onStrokeComplete?: (stroke: DrawingStroke) => void;
  className?: string;
}

const FREEHAND_OPTIONS = { thinning: 0.6, smoothing: 0.55, streamline: 0.5 } as const;

/**
 * The shared HTML5 canvas surface for Drawing — plain `<canvas>` +
 * perfect-freehand for stroke rendering (not a whiteboard framework, per
 * the product decision: "ne transforme pas le canvas en nouvelle state
 * machine"). This component owns ZERO game rules — it doesn't know
 * whose turn it is, what the timer says, or whether a stroke is
 * "allowed"; it only ever renders `strokes` and, when `!readOnly`,
 * reports a completed stroke upward via `onStrokeComplete`. The caller
 * (PlayerDrawingPanel) decides whether that's even wired to anything —
 * the actual authorization for whether a stroke is accepted happens
 * server-side, live, on every single `drawing:stroke` send (see
 * src/server/sockets/drawing.ts's own doc comment) — this component's
 * `readOnly` prop is a UI nicety, never the real boundary.
 *
 * A stroke is batched CLIENT-SIDE while the pointer is down (a plain
 * array of normalized points, held in a ref — not React state, since a
 * pointermove can fire dozens of times a second and re-rendering on
 * every one would be wasteful) and only reported once, on pointerup —
 * one `drawing:stroke` network message per stroke, not per point, which
 * is also what keeps src/server/sockets/drawing.ts's own live-authorization
 * check (a real DB read per message) cheap in practice.
 *
 * Coordinates are captured/replayed entirely in normalized [0,1] space
 * (via the canvas element's own `getBoundingClientRect`), the same
 * resize-safety convention GeoGuessr's `targetX`/`targetY` already
 * established — a stroke drawn on a phone and viewed on an OBS-scale
 * Display renders correctly on both without either side needing to know
 * the other's pixel dimensions.
 */
export function DrawingCanvas({ strokes, readOnly = false, color = "#f5f5f5", width = 6, onStrokeComplete, className }: DrawingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const activePointsRef = useRef<{ x: number; y: number }[]>([]);
  const activePointerIdRef = useRef<number | null>(null);
  const activeColorRef = useRef(color);
  const activeWidthRef = useRef(width);
  // Mirrors `strokes` for the SAME reason activeColorRef/activeWidthRef
  // exist: `render()` is called from the ResizeObserver callback below,
  // which is set up in a mount-only (`[]`-dep) effect — a real,
  // reproduced bug this ref closes ("Team A can't see what Team B
  // drew"): without it, that callback's `render` closure permanently
  // captures whatever `strokes` was at MOUNT time (often `[]`, since the
  // real snapshot arrives async, a moment after this canvas first
  // mounts) — and because a fresh `<DrawingCanvas>` mounts for the
  // "guessing" reveal, ANY resize the observer notices afterward (the
  // reveal headline's own entrance animation reflowing the layout is
  // enough) redraws with that stale, empty array, silently wiping the
  // real strokes the `[strokes]` effect below had just drawn. Assigned
  // directly during render (not in an effect) — a plain ref mutation
  // triggers no re-render, so there's no extra render+effect pass to
  // avoid one.
  const strokesRef = useRef(strokes);
  // The rendered bitmap of every COMMITTED stroke, cached off-DOM — see
  // `renderCommittedLayer`'s own doc comment below for why this exists:
  // it's the fix for a real, measurable perf cost, not a stylistic
  // rewrite. Never attached to the page; only ever a blit source.
  const committedLayerRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    activeColorRef.current = color;
    activeWidthRef.current = width;
  }, [color, width]);

  function drawStroke(ctx: CanvasRenderingContext2D, points: { x: number; y: number }[], strokeColor: string, strokeWidth: number, cssWidth: number, cssHeight: number) {
    if (points.length === 0) return;
    const pixelPoints = points.map((p) => [p.x * cssWidth, p.y * cssHeight]);
    const outline = getStroke(pixelPoints, { ...FREEHAND_OPTIONS, size: strokeWidth * 3 });
    if (outline.length === 0) return;
    const path = new Path2D();
    path.moveTo(outline[0]![0], outline[0]![1]);
    for (let i = 1; i < outline.length; i++) path.lineTo(outline[i]![0], outline[i]![1]);
    path.closePath();
    ctx.fillStyle = strokeColor;
    ctx.fill(path);
  }

  /**
   * Rebuilds the CACHED bitmap of every already-committed stroke — the
   * one genuinely expensive part of rendering this canvas (`getStroke`
   * refits a whole smoothed outline per stroke from its raw point list).
   * Only ever called when the committed set actually changes (the
   * `[strokes]` effect below) or the canvas resizes (its backing store
   * dimensions changed under it) — NOT on every pointer move. A real,
   * measured perf issue this fixes: the ORIGINAL version recomputed
   * every committed stroke's outline again on every single `pointermove`
   * while the CURRENT stroke was still being drawn, which is wasted,
   * repeated work growing with the turn (stroke 30 of a busy drawing
   * re-ran `getStroke` for strokes 1..29 dozens of times a second, for
   * data that hadn't changed since the last commit). `render()` below
   * now just blits this cached bitmap — cheap — and draws only the ONE
   * stroke that's actually still moving on top of it.
   */
  function renderCommittedLayer() {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0 || canvas.height === 0) return;
    let layer = committedLayerRef.current;
    if (!layer) {
      layer = document.createElement("canvas");
      committedLayerRef.current = layer;
    }
    if (layer.width !== canvas.width || layer.height !== canvas.height) {
      layer.width = canvas.width;
      layer.height = canvas.height;
    }
    const ctx = layer.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    for (const stroke of strokesRef.current) drawStroke(ctx, stroke.points, stroke.color, stroke.width, cssWidth, cssHeight);
  }

  useEffect(() => {
    strokesRef.current = strokes;
    renderCommittedLayer();
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  // The per-frame path — cheap on purpose (see `renderCommittedLayer`'s
  // own doc comment): one bitmap blit for everything already committed,
  // plus outline math for only the ONE stroke still actively moving.
  // Identical pixels to the old always-recompute-everything version
  // (same `drawStroke` math, same 1:1-scale blit — nothing here changes
  // what a viewer sees, only how much work repaints it).
  function render() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const cssWidth = canvas.clientWidth;
    const cssHeight = canvas.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const layer = committedLayerRef.current;
    if (layer && layer.width > 0 && layer.height > 0) ctx.drawImage(layer, 0, 0, cssWidth, cssHeight);
    if (activePointsRef.current.length > 0) drawStroke(ctx, activePointsRef.current, activeColorRef.current, activeWidthRef.current, cssWidth, cssHeight);
  }

  // Keep the canvas's own backing store in sync with its CSS size (×
  // devicePixelRatio, for crisp strokes on high-DPI screens) — a plain
  // `width`/`height` attribute mismatch is what makes a `<canvas>` blurry
  // or stretched; this is the standard fix, redrawing whenever the
  // element's actual rendered size changes (a phone rotating, a window
  // resizing, the sidebar layout reflowing).
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const observer = new ResizeObserver(() => {
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
      // The committed-layer cache is sized off `canvas.width`/`.height`
      // (the backing store) — a resize invalidates it same as a genuine
      // stroke change would, so it's rebuilt here too, not just repainted.
      renderCommittedLayer();
      render();
    });
    observer.observe(container);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function normalizedPoint(clientX: number, clientY: number): { x: number; y: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();

    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));

    return { x, y };
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (readOnly) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerIdRef.current = event.pointerId;
    activePointsRef.current = [normalizedPoint(event.clientX, event.clientY)];
    render();
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (readOnly || activePointerIdRef.current !== event.pointerId) return;
    activePointsRef.current = [...activePointsRef.current, normalizedPoint(event.clientX, event.clientY)];
    render();
  }

  function finishStroke(event: React.PointerEvent<HTMLCanvasElement>) {
    if (readOnly || activePointerIdRef.current !== event.pointerId) return;
    const points = activePointsRef.current;
    activePointsRef.current = [];
    activePointerIdRef.current = null;
    // A tap with no real movement isn't a stroke worth sending — avoids
    // spamming the network (and the server's live-authorization DB read)
    // with single-point "strokes" a stray tap would otherwise produce.
    if (points.length >= 2 && onStrokeComplete) {
      onStrokeComplete({ points, color: activeColorRef.current, width: activeWidthRef.current });
    }
    render();
  }

  return (
    <div ref={containerRef} className={[styles.canvasWrap, className].filter(Boolean).join(" ")}>
      <canvas
        ref={canvasRef}
        className={[styles.canvas, readOnly ? styles.readOnly : styles.drawable].join(" ")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={finishStroke}
        onPointerLeave={finishStroke}
      />
    </div>
  );
}
