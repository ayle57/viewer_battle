"use client";

import { useEffect, useLayoutEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import styles from "./ClickableImageMap.module.css";

/** A pointerdown->pointerup movement below this counts as a tap (place), not a drag (pan) — see the fullscreen pointer handler's own doc comment. */
const DRAG_THRESHOLD_PX = 6;

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
  /** A persistent, solid ring — "this is the one that's currently selected," visible even in a still frame (the pulse alone reads as "recently active," easy to miss if you're not watching it animate). Independent of `pulse`; a caller typically sets both together for the one armed/selected marker. */
  selected?: boolean;
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
  /**
   * A REAL, REPRODUCED bug this closes: without this, the ONLY way to
   * interact with the map at all was `onPick` — tapping literally
   * anywhere, INCLUDING directly on an already-placed marker, placed/
   * moved the CALLER's own pin to that spot. Confirmed directly (two
   * real players, GeoGuessr): Team A's own player tapped exactly on
   * their TEAMMATE's pin meaning to select it, and their OWN pin
   * silently jumped there instead, landing the two markers on top of
   * each other — "pourquoi mon pin a bougé alors que je voulais juste
   * sélectionner celui de mon teammate." Present -> each marker renders
   * as a real `<button>` (a real, if generously padded, tap target) that
   * calls this with the marker's own `id` and stops the event from
   * reaching `onPick` at all — tapping an EXISTING pin now always means
   * "select this one," never "move my own pin here"; tapping empty map
   * is still the only thing that places/moves anything. Reuses the
   * fullscreen pointer handler's own existing `event.target.closest(
   * "button")` guard (already built for Close/Zoom) for free — a real
   * `<button>` here is automatically exempt from the pan/pinch/tap
   * state machine with no separate wiring needed. Absent (the default)
   * -> markers render exactly as before, inert `<span>`s — zero
   * behavior change for every other caller (Host régie, Display,
   * Content Studio target placement) that never passes this.
   */
  onMarkerClick?: (markerId: string) => void;
  disabled?: boolean;
  /** A neutral placeholder frame with no image loaded yet — the Content Studio round editor's "no image chosen" state. */
  empty?: boolean;
  emptyLabel?: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.5;
/**
 * Wheel/trackpad zoom is scaled by the event's OWN `deltaY` magnitude,
 * not a fixed step per event — a mouse fires one big notch (~100) per
 * click, a trackpad fires a dozen+ tiny deltas (~5-10) for the same
 * physical gesture. A fixed step applied per event felt fine on a mouse
 * but made a trackpad blow straight through to MAX_ZOOM off one small
 * swipe (confirmed: 15 real trackpad-sized deltas x a flat 0.15 step
 * ate more than half the entire zoom range). Scaling by magnitude
 * instead gives a mouse notch roughly its old 0.15 feel
 * (100 * WHEEL_ZOOM_SENSITIVITY = 0.15) while a trackpad's small deltas
 * produce proportionally small, smooth steps — the min/max clamp below
 * just keeps either extreme (a huge synthetic deltaY, or a near-zero
 * one) from ever being a complete no-op or a single-event jump to MAX.
 */
const WHEEL_ZOOM_SENSITIVITY = 0.0015;
const WHEEL_ZOOM_STEP_MIN = 0.01;
const WHEEL_ZOOM_STEP_MAX = 0.4;

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
 * server-side resize/optimization, so whatever source file a round
 * points at ships at full resolution to every client. The BUILT-IN demo
 * map (public/images/maps/ac_odyssey_world_map.jpg) used to be
 * 16384x16384px/~37MB — measured at ~2.5s to fully load even on
 * localhost with zero contention, i.e. far worse on a real connection —
 * and has been resized down to 4096x4096px/~2.8MB (still comfortably
 * sharp at this component's own MAX_ZOOM=4, confirmed visually). That
 * only fixes the ONE built-in asset; a Host's own uploaded map can still
 * be as large as MAX_UPLOAD_BYTES allows (src/server/content/
 * geoAssets.ts) with no resize step. A real fix for THAT (next/image, or
 * a proper upload/resize pipeline) is a real follow-up, deliberately not
 * done here — would mean a new dependency for what's still a working,
 * if unoptimized, path.
 *
 * ZOOM lives ENTIRELY in a dedicated fullscreen overlay, never inline —
 * a real, reported UX complaint about the previous version ("le truc
 * pour zoomer est affreux"): zooming an inline map cramped into a card
 * mid-page made panning fiddly and the whole page layout jump around as
 * `.viewport` grew. The map you see during ordinary gameplay is ALWAYS
 * at its plain, natural size — genuinely nothing to configure or reset,
 * since it has no zoom state of its own at all. Two ways to enter the
 * fullscreen zoom space (wherever `onPick` is provided, same `allowZoom`
 * gate the old zoom controls used — a pure-display map has nothing to
 * zoom into): scrolling the wheel over the map (the natural "I want to
 * zoom" gesture, intercepted before it does anything else — see the
 * wheel effect below), or the explicit expand button in the corner (the
 * ONLY entry point on a touch device, which has no wheel gesture at
 * all). Once open, the split is deliberately the SAME one Google Maps'
 * own full page uses (not its embedded-iframe one, which needs Ctrl to
 * avoid hijacking page scroll — no such competing scroll exists once
 * this is a dedicated fullscreen space): a plain wheel/trackpad scroll
 * ALWAYS zooms, cursor-anchored, no modifier needed (an earlier Ctrl-
 * gated version — real, reported feedback: "vraiment guez" — made
 * scrolling feel unresponsive/broken by default, since Ctrl-to-zoom is
 * a design-tool convention, Figma/Photoshop, not what reads as "a map"
 * to anyone). Panning is left-drag's job instead (mouse or touch,
 * unified via PointerEvent — a manual tap-vs-drag distinction, not the
 * browser's native `click`, see that effect's own doc comment on why),
 * and a genuine tap (not a drag) places — replacing the old right-
 * click-drag, ALSO real, reported feedback: undiscoverable, mouse-only,
 * not how any map/photo app trains people to expect panning to work.
 * The +/- buttons are still there too. All of this works with the
 * whole viewport to move around in instead of a page-width card.
 * Exiting (×, Escape, or clicking the dark
 * backdrop) always returns to that same plain, natural-size map —
 * "retour exactement à l'état précédent" is automatic, not something
 * this component has to remember, because the inline map's own state
 * never changed in the first place; only the OVERLAY had a zoom level,
 * and it's gone the instant the overlay unmounts. Whatever guess/target
 * was placed while zoomed in is real, ordinary `sendAction` state (same
 * `onPick` callback either mode calls) — entirely unaffected by closing
 * the overlay.
 */
export function ClickableImageMap({ imageUrl, alt, markers = [], lines = [], onPick, onMarkerClick, disabled = false, empty = false, emptyLabel }: ClickableImageMapProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const allowZoom = Boolean(onPick) && !disabled && !empty;

  // Render-phase reset (React's blessed "adjusting state when a prop
  // changes" pattern, same shape MapFrame's own zoom-reset-on-image-
  // change and this codebase's other timer/reveal-stage hooks already
  // use — see e.g. DisplayGeoPanel's useRevealStage) — a locked/disabled
  // map, or the image genuinely changing under an already-open overlay
  // (e.g. a round somehow advancing while zoomed in), has nothing left
  // to zoom into; close rather than leave a stale overlay open over
  // content it no longer applies to.
  const [openedForImage, setOpenedForImage] = useState(imageUrl);
  let effectiveFullscreen = fullscreen;
  if (openedForImage !== imageUrl) {
    setOpenedForImage(imageUrl);
    effectiveFullscreen = false;
    if (fullscreen) setFullscreen(false);
  }
  if (effectiveFullscreen && !allowZoom) {
    effectiveFullscreen = false;
    setFullscreen(false);
  }

  if (empty) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>{emptyLabel ?? "No image chosen yet"}</p>
      </div>
    );
  }

  return (
    <>
      <MapFrame
        imageUrl={imageUrl}
        alt={alt}
        markers={markers}
        lines={lines}
        onPick={onPick}
        onMarkerClick={onMarkerClick}
        disabled={disabled}
        allowZoom={allowZoom}
        fullscreen={false}
        onOpenFullscreen={allowZoom ? () => setFullscreen(true) : undefined}
      />
      {effectiveFullscreen && (
        <div className={styles.overlayBackdrop} onClick={() => setFullscreen(false)}>
          <MapFrame
            imageUrl={imageUrl}
            alt={alt}
            markers={markers}
            lines={lines}
            onPick={onPick}
            onMarkerClick={onMarkerClick}
            disabled={disabled}
            allowZoom={allowZoom}
            fullscreen
            onCloseFullscreen={() => setFullscreen(false)}
          />
        </div>
      )}
    </>
  );
}

interface MapFrameProps {
  imageUrl: string;
  alt: string;
  markers: MapMarker[];
  lines: MapLine[];
  onPick?: (x: number, y: number) => void;
  onMarkerClick?: (markerId: string) => void;
  disabled: boolean;
  allowZoom: boolean;
  fullscreen: boolean;
  onOpenFullscreen?: () => void;
  onCloseFullscreen?: () => void;
}

/**
 * The actual map surface — rendered TWICE by ClickableImageMap above
 * (never both visible at once): once inline, always at a fixed 1x with
 * zoom/pan entirely inert, and once inside the fullscreen overlay, where
 * every hook below actually does something. Splitting it this way
 * (rather than one component with a bunch of `fullscreen ? … : …`
 * branches threaded through every hook) is what makes "the inline map
 * has no zoom state at all" literally true instead of just reset on
 * close — the inline instance's zoom-related hooks below all no-op via
 * `fullscreen`/`allowZoom` guards at their very first line.
 */
function MapFrame({ imageUrl, alt, markers, lines, onPick, onMarkerClick, disabled, allowZoom, fullscreen, onOpenFullscreen, onCloseFullscreen }: MapFrameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const effectiveZoom = fullscreen ? zoom : MIN_ZOOM;
  const zoomInteractive = fullscreen && allowZoom;

  // Read inside the effects below via a ref, not the `effectiveZoom`
  // closure — that lets the native listeners stay attached for the whole
  // interactive lifetime of this map instead of being torn down and
  // re-added on every single zoom tick.
  const zoomRef = useRef(effectiveZoom);
  useEffect(() => {
    zoomRef.current = effectiveZoom;
  }, [effectiveZoom]);

  // A REAL, REPRODUCED bug this rework used to still have (a leftover
  // from before zoom lived exclusively in the fullscreen overlay): a
  // `naturalHeight`-driven `max-height` clamp on `.viewport`, originally
  // built to stop a ZOOMED-IN inline map from growing past its own
  // natural size. Since the inline instance is now ALWAYS at a fixed
  // 1x — it never zooms at all any more, see this component's own top
  // doc comment — that clamp had nothing left to guard against, and
  // instead became a real hazard: if the ResizeObserver's first
  // callback fired before the `<img>` had actually finished loading
  // (a genuine race — `getBoundingClientRect()` on a not-yet-loaded
  // image reads whatever height the browser is placeholder-rendering
  // it at, not its final one), `naturalHeight` could latch onto a value
  // SHORTER than the image's real rendered height, permanently clipping
  // the bottom portion of the map — reported as "on ne peut pas
  // sélectionner toute la map." Removed entirely: the inline map now
  // just renders at its own natural CSS size, unconstrained, exactly
  // like any other `width: 100%; height: auto` image.

  // Wheel-to-zoom, cursor-anchored — a native (non-passive) listener,
  // not React's onWheel: React attaches onWheel as a passive listener,
  // where `preventDefault()` is a silent no-op, and without it the page/
  // dialog scrolls instead of (or as well as) the map zooming. Two
  // different jobs depending on which instance this is: the INLINE one
  // intercepts the very first wheel tick (any modifier) and OPENS the
  // fullscreen overlay instead of zooming in place at all — the
  // "scrolling detaches the map" behavior this whole rework exists for.
  //
  // The FULLSCREEN one: ANY wheel/trackpad scroll zooms, no modifier
  // needed — real, reported feedback ("vraiment guez") on an earlier
  // Ctrl-gated version of this: requiring Ctrl to zoom is the right call
  // for a map embedded INLINE on a scrollable page (stop an innocent
  // page-scroll from hijacking the widget — Google Maps' own embedded
  // iframe famously does exactly this, with a "use ctrl+scroll to zoom"
  // hint), but this is a DEDICATED fullscreen space with no competing
  // page scroll to protect — the same Google Maps, in its own full page
  // rather than embedded, zooms on a plain scroll with no modifier at
  // all, which is the far more universally understood "map" gesture
  // (Ctrl-to-zoom is a design-tool convention — Figma/Photoshop — not
  // what someone expects from something that visually reads as a map).
  // Panning is drag's job now (the effect right below), not scroll's —
  // scroll is unambiguously "zoom" in here, full stop, exactly Google
  // Maps' own full-page split of the two gestures.
  const pendingScrollRef = useRef<{ scrollLeft: number; scrollTop: number } | null>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !allowZoom) return;

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      if (!fullscreen) {
        onOpenFullscreen?.();
        return;
      }
      const rect = viewport!.getBoundingClientRect();
      const cursorX = event.clientX - rect.left;
      const cursorY = event.clientY - rect.top;
      const prevZoom = zoomRef.current;
      const direction = event.deltaY > 0 ? -1 : 1;
      const step = clamp(Math.abs(event.deltaY) * WHEEL_ZOOM_SENSITIVITY, WHEEL_ZOOM_STEP_MIN, WHEEL_ZOOM_STEP_MAX);
      const nextZoom = clamp(prevZoom + direction * step, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === prevZoom) return;

      const ratio = nextZoom / prevZoom;
      pendingScrollRef.current = {
        scrollLeft: (viewport!.scrollLeft + cursorX) * ratio - cursorX,
        scrollTop: (viewport!.scrollTop + cursorY) * ratio - cursorY,
      };
      setZoom(nextZoom);
    }

    viewport.addEventListener("wheel", handleWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", handleWheel);
  }, [allowZoom, fullscreen, onOpenFullscreen]);

  // Applies the scroll offset `handleWheel` computed, once `.frame` has
  // ACTUALLY grown to the new zoom width — not a `requestAnimationFrame`
  // guess at when that might have happened. This state update comes
  // from a native `wheel` listener, outside React's own event system,
  // so React doesn't guarantee the DOM reflects the new `effectiveZoom`
  // by the very next animation frame; a plain `requestAnimationFrame`
  // callback could fire BEFORE the commit landed, assign scrollLeft/Top
  // against the still-OLD (narrower) scrollable width — silently
  // clamping them — and then never get another chance to correct once
  // the resize actually happens a moment later. The visible result,
  // confirmed: a jump/glitch on zoom, the exact thing reported. A
  // `useLayoutEffect` keyed on `effectiveZoom` is guaranteed to run
  // AFTER the DOM mutation for this exact zoom change has committed and
  // BEFORE the browser paints — the one timing that's actually correct.
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    const viewport = viewportRef.current;
    if (!pending || !viewport) return;
    viewport.scrollLeft = pending.scrollLeft;
    viewport.scrollTop = pending.scrollTop;
    pendingScrollRef.current = null;
  }, [effectiveZoom]);

  const [panning, setPanning] = useState(false);

  // Drag-to-pan + tap-to-place — the fullscreen instance's ENTIRE
  // pointer story, replacing both the old right-click-drag pan (real
  // user feedback: "vraiment guez" — undiscoverable, and a plain
  // left-drag is what literally every map/photo app already trains
  // people to expect) and the inline instance's native `onClick`
  // (deliberately NOT reused here — see below).
  //
  // A single left/primary-button pointer stream decides for itself,
  // by how far it actually moved, whether it was a TAP (place a guess/
  // target — same `onPick` callback the inline map calls) or a DRAG
  // (pan the zoomed content) — `DRAG_THRESHOLD_PX` of real movement is
  // the line between them. This is a manual reimplementation of the
  // "click doesn't fire after a real drag" distinction the browser
  // gives `onClick` for free at zoom 1 (see the inline `handleClick`'s
  // own doc comment) — deliberately NOT reused here because
  // `setPointerCapture`, needed so a fast drag that outruns the cursor
  // still keeps receiving `pointermove`, is exactly what a previous
  // version of this component found ALSO breaks the browser's own
  // native `click` synthesis on the same element (a real, previously-
  // reproduced regression). Doing the tap/drag decision ourselves in
  // `pointerup` — rather than leaning on native `click` at all — sidesteps
  // that interference entirely instead of working around it, and unifies
  // mouse/touch/pen into one code path for free (PointerEvent's whole
  // point): a real touch tap-vs-drag on a phone gets the identical
  // threshold logic a mouse does.
  // A SECOND finger touching down mid-gesture upgrades this from a
  // single-finger drag into a real pinch-to-zoom — tracked via a plain
  // `Map<pointerId, {x,y}>` of every currently-active pointer on this
  // surface (not just the one being dragged), since that's what
  // "how many fingers are down right now" actually means. Real, missing
  // mobile UX: the only way to zoom on a touch device used to be the
  // +/- buttons — every mobile map/photo app trains people to reach for
  // a pinch first. Distance-ratio scaling, midpoint-anchored (the exact
  // same cursor-anchoring math/refs the wheel handler above already
  // uses for a mouse — `pendingScrollRef`/`zoomRef` reused as-is, one
  // anchoring implementation for both input types, not two).
  const activePointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchRef = useRef<{ startDistance: number; startZoom: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; scrollLeft: number; scrollTop: number; moved: boolean } | null>(null);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !zoomInteractive) return;

    function pointerMidpoint(): { x: number; y: number } {
      const points = [...activePointersRef.current.values()];
      return { x: (points[0]!.x + points[1]!.x) / 2, y: (points[0]!.y + points[1]!.y) / 2 };
    }
    function pointerDistance(): number {
      const points = [...activePointersRef.current.values()];
      return Math.hypot(points[0]!.x - points[1]!.x, points[0]!.y - points[1]!.y);
    }

    function handlePointerDown(event: PointerEvent) {
      if (event.button !== 0) return; // left/primary only — touch and pen report button 0 too
      // A REAL, REPRODUCED bug this closes: Close/Zoom (and any future
      // control rendered inside `.viewport`, e.g. `.zoomControls`) are
      // DOM children of the same element this listener is attached to
      // — a native `addEventListener` on an ancestor still fires for a
      // `pointerdown` that started on a descendant and bubbled up,
      // React's own `stopPropagation()` on those controls' SYNTHETIC
      // click handlers notwithstanding (that only stops OTHER React
      // handlers from seeing the later `click`, it can't un-fire this
      // native listener's own earlier `pointerdown`). Left unguarded,
      // clicking Close/Zoom still ran through this whole function —
      // `setPointerCapture` on `.viewport` REDIRECTS the subsequent
      // synthesized `click` away from the button entirely and onto the
      // capturing `.viewport` instead (the exact same interference this
      // component's own top doc comment already documented for the
      // MAP's tap-to-place, just never guarded against for these
      // OTHER buttons) — reported as "la croix a une hitbox bizarre":
      // intermittently unresponsive, exactly what a capture race reads
      // like. `event.target.closest("button")` lets any real button
      // handle its own native click completely undisturbed.
      if (event.target instanceof Element && event.target.closest("button")) return;
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      viewport!.setPointerCapture(event.pointerId);

      if (activePointersRef.current.size === 2) {
        // A second finger just landed — this is now a pinch, not a
        // drag. Cancel whatever single-pointer drag/tap tracking was in
        // progress (never placing a tap for what's actually the start
        // of a pinch).
        dragRef.current = null;
        setPanning(false);
        pinchRef.current = { startDistance: pointerDistance(), startZoom: zoomRef.current };
      } else if (activePointersRef.current.size === 1) {
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, scrollLeft: viewport!.scrollLeft, scrollTop: viewport!.scrollTop, moved: false };
      }
    }

    function handlePointerMove(event: PointerEvent) {
      if (!activePointersRef.current.has(event.pointerId)) return;
      activePointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      const pinch = pinchRef.current;
      if (pinch && activePointersRef.current.size === 2) {
        const rect = viewport!.getBoundingClientRect();
        const mid = pointerMidpoint();
        const cursorX = mid.x - rect.left;
        const cursorY = mid.y - rect.top;
        const distance = pointerDistance();
        const nextZoom = clamp((distance / pinch.startDistance) * pinch.startZoom, MIN_ZOOM, MAX_ZOOM);
        const prevZoom = zoomRef.current;
        if (nextZoom === prevZoom) return;
        const ratio = nextZoom / prevZoom;
        pendingScrollRef.current = {
          scrollLeft: (viewport!.scrollLeft + cursorX) * ratio - cursorX,
          scrollTop: (viewport!.scrollTop + cursorY) * ratio - cursorY,
        };
        setZoom(nextZoom);
        return;
      }

      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
        drag.moved = true;
        setPanning(true);
      }
      if (drag.moved) {
        viewport!.scrollLeft = drag.scrollLeft - dx;
        viewport!.scrollTop = drag.scrollTop - dy;
      }
    }

    function endPointer(event: PointerEvent) {
      const wasTracked = activePointersRef.current.delete(event.pointerId);
      if (!wasTracked) return;
      try {
        viewport!.releasePointerCapture(event.pointerId);
      } catch {
        // Already released (e.g. the browser did it on its own for a cancelled touch) — never worth failing over.
      }

      if (pinchRef.current) {
        // Only truly ends once fewer than 2 fingers remain — a stray
        // 3rd finger lifting off mid-pinch (2 still down) shouldn't
        // reset anything. Never resumes as a single-finger drag from
        // mid-gesture once it genuinely does end (simplicity; a user
        // lifting a finger from a pinch is done zooming, not starting a
        // fresh pan in the same breath).
        if (activePointersRef.current.size < 2) pinchRef.current = null;
        return;
      }

      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const wasDrag = drag.moved;
      dragRef.current = null;
      setPanning(false);
      // A genuine tap, not a drag — place, exactly like the inline
      // map's own `handleClick` does, computed the same way (against
      // `containerRef`'s own live box, correct at any zoom/scroll
      // position).
      if (!wasDrag && onPick && !disabled) {
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          const x = clamp01((event.clientX - rect.left) / rect.width);
          const y = clamp01((event.clientY - rect.top) / rect.height);
          onPick(x, y);
        }
      }
    }

    viewport.addEventListener("pointerdown", handlePointerDown);
    viewport.addEventListener("pointermove", handlePointerMove);
    viewport.addEventListener("pointerup", endPointer);
    viewport.addEventListener("pointercancel", endPointer);
    return () => {
      // `activePointersRef` holds a plain mutable Map (created once via
      // `useRef(new Map())`, never a DOM node), not something that can
      // go stale before this cleanup runs the way the lint rule below
      // is guarding against — safe to read/clear `.current` directly.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      activePointersRef.current.clear();
      pinchRef.current = null;
      dragRef.current = null;
      viewport.removeEventListener("pointerdown", handlePointerDown);
      viewport.removeEventListener("pointermove", handlePointerMove);
      viewport.removeEventListener("pointerup", endPointer);
      viewport.removeEventListener("pointercancel", endPointer);
    };
  }, [zoomInteractive, onPick, disabled]);

  // A brief, self-dismissing gesture hint — real, reported feedback
  // that this whole interaction model (scroll/pinch to zoom, drag to
  // pan, tap to place) was undiscoverable with nothing on screen
  // explaining it. Purely cosmetic — a local fade timer, same class as
  // GameStartingSequence's own beats, never anything deciding gameplay
  // — and naturally resets fresh every time the overlay opens (a new
  // `MapFrame` mount, since `useState(true)`'s initial value only ever
  // applies once per mount), so a player who dismisses it by waiting it
  // out still sees it again next time they open a fresh round's map.
  const [showHint, setShowHint] = useState(zoomInteractive);
  useEffect(() => {
    if (!zoomInteractive) return;
    const timeout = setTimeout(() => setShowHint(false), 3500);
    return () => clearTimeout(timeout);
  }, [zoomInteractive]);

  // Escape closes the fullscreen overlay — same convention as this
  // app's own Dialog primitive (src/ui/primitives/Dialog). Only wired
  // up in the fullscreen instance.
  useEffect(() => {
    if (!fullscreen || !onCloseFullscreen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseFullscreen!();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [fullscreen, onCloseFullscreen]);

  // `onClick` — the INLINE instance only (`zoomInteractive` is always
  // false there, since inline never zooms). The FULLSCREEN instance
  // handles placement itself, from its own `pointerup` above — see that
  // effect's own doc comment on why native `click` isn't reused there
  // (`setPointerCapture` interferes with it). Native `click` already
  // does the right thing for free at a fixed zoom 1 with no panning
  // possible: it simply never fires after a real drag (the browser's
  // own tap-vs-drag distinction), so plain `onClick` is both correct
  // and the simplest option for the one case that actually needs it.
  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!onPick || disabled) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    const x = clamp01((event.clientX - rect.left) / rect.width);
    const y = clamp01((event.clientY - rect.top) / rect.height);
    onPick(x, y);
  }

  // A real, audited gap this closes: placing a guess/target had NO
  // keyboard path at all — `.frame` used to carry `role="button"` (a
  // leaf widget role) while genuinely CONTAINING real `<button>` marker
  // dots, which is invalid ARIA nesting on top of not even being
  // focusable (no `tabIndex`, so that role did nothing for a keyboard
  // user anyway). `role="application"` below is the correct fix for
  // BOTH problems at once — it's a container role explicitly meant to
  // hold interactive descendants (the marker buttons stay independently
  // Tab-reachable, unaffected), and it tells assistive tech to hand
  // arrow keys to THIS component instead of intercepting them for its
  // own browse-mode navigation, which the crosshair scheme below needs.
  // Deliberately NOT a drag/pointer reimplementation — a simple, always-
  // available alternative: Enter/Space drops a keyboard cursor at the
  // center, arrow keys nudge it (Shift for a bigger step), Enter/Space
  // again places at wherever it's sitting. Purely additive — the
  // existing pointer/click paths above are completely untouched.
  const [keyboardCursor, setKeyboardCursor] = useState<{ x: number; y: number } | null>(null);
  const keyboardActive = Boolean(onPick) && !disabled;

  function handleFrameKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!onPick || disabled) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (keyboardCursor) onPick(keyboardCursor.x, keyboardCursor.y);
      else setKeyboardCursor({ x: 0.5, y: 0.5 });
      return;
    }
    if (!keyboardCursor) return;
    const step = event.shiftKey ? 0.08 : 0.02;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      setKeyboardCursor({ x: clamp01(keyboardCursor.x - step), y: keyboardCursor.y });
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      setKeyboardCursor({ x: clamp01(keyboardCursor.x + step), y: keyboardCursor.y });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setKeyboardCursor({ x: keyboardCursor.x, y: clamp01(keyboardCursor.y - step) });
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setKeyboardCursor({ x: keyboardCursor.x, y: clamp01(keyboardCursor.y + step) });
    } else if (event.key === "Escape") {
      // Cancels the keyboard cursor first, without also closing the
      // fullscreen overlay on the same keypress (Dialog.tsx-style
      // Escape is wired at `document` level, in the bubble phase, which
      // this stopPropagation reaches before it does) — a second Escape
      // still closes the overlay normally.
      event.preventDefault();
      event.stopPropagation();
      setKeyboardCursor(null);
    }
  }

  // Only clears when focus genuinely leaves the whole `.frame` subtree
  // — `onBlur`/`focusout` also fires when focus moves from `.frame`
  // onto one of ITS OWN marker buttons (a normal Tab step), which must
  // never be mistaken for "the user left the map."
  function handleFrameBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setKeyboardCursor(null);
  }

  return (
    <div
      className={[styles.viewport, fullscreen && styles.overlayViewport].filter(Boolean).join(" ")}
      ref={viewportRef}
      onClick={fullscreen ? (event) => event.stopPropagation() : undefined} // clicking the map itself (not the backdrop around it) must never close the overlay
    >
      <div
        ref={containerRef}
        className={[
          styles.frame,
          onPick && !disabled && styles.interactive,
          zoomInteractive && styles.frameZoomInteractive,
          panning && styles.framePanning,
        ]
          .filter(Boolean)
          .join(" ")}
        style={{ width: `${effectiveZoom * 100}%` }}
        onClick={zoomInteractive ? undefined : handleClick} // the fullscreen instance places from its own pointerup handler above instead — see that effect's own doc comment
        role={keyboardActive ? "application" : undefined}
        aria-roledescription={keyboardActive ? "map" : undefined}
        aria-label={keyboardActive ? "Map. Click or tap anywhere to place your guess, or press Enter to place it with the keyboard." : undefined}
        tabIndex={keyboardActive ? 0 : undefined}
        onKeyDown={keyboardActive ? handleFrameKeyDown : undefined}
        onBlur={keyboardActive ? handleFrameBlur : undefined}
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

        {markers.map((marker) => {
          // Real, reported bug this closes ("ça n'a rien changé" — a
          // second look after the border/click fixes above): the DOT
          // itself used to be nudged inward near an edge (the OLD
          // `renderPercent` clamp, up to 10 full percentage points —
          // measured directly, a click on the literal top-left corner
          // rendered its pin ~55px / ~9.6% away from where it was
          // actually clicked), to keep the LABEL from overflowing past
          // the image. That's backwards: the DOT is the one thing that
          // has to be pixel-exact (it's the real, scored coordinate —
          // moving it lies about where the guess actually landed, which
          // reads exactly like "clicking the corner doesn't work"). The
          // label is cosmetic. Fixed the honest way this file's own doc
          // comment already called out as the real fix: the dot now
          // ALWAYS renders at the true, unclamped coordinate; only the
          // LABEL flips which side of the dot it sits on (left/right/
          // bottom-vs-top anchored via `.markerLabel`'s own edge
          // classes below) once it's close enough to an edge that its
          // default placement would clip past the image.
          const nearLeft = marker.x < 0.15;
          const nearRight = marker.x > 0.85;
          const nearBottom = marker.y > 0.85;
          // `pointer-events` are OFF for `.marker` itself (its own CSS) —
          // deliberately, so a tap that LANDS anywhere over its (rather
          // generous, for tap-friendliness) footprint still falls through
          // to the map underneath by default. The DOT gets them back,
          // ONLY when `onMarkerClick` is provided, and ONLY as a real
          // `<button>` (this prop's own doc comment on why that specific
          // element type matters for the fullscreen pointer handler).
          const Dot = onMarkerClick ? "button" : "span";
          return (
            <span
              key={marker.id}
              className={[styles.marker, styles[`marker_${marker.color}`], marker.pulse && styles.markerPulse, marker.selected && styles.markerSelected]
                .filter(Boolean)
                .join(" ")}
              style={{ left: `${marker.x * 100}%`, top: `${marker.y * 100}%` }}
            >
              <Dot
                type={onMarkerClick ? "button" : undefined}
                className={[styles.markerDot, onMarkerClick && styles.markerDotSelectable].filter(Boolean).join(" ")}
                aria-hidden={onMarkerClick ? undefined : "true"}
                aria-label={onMarkerClick && marker.label ? `Select ${marker.label}'s spot` : undefined}
                onClick={
                  onMarkerClick
                    ? (event: ReactMouseEvent) => {
                        event.stopPropagation();
                        onMarkerClick(marker.id);
                      }
                    : undefined
                }
              />
              {marker.label && (
                <span
                  className={[styles.markerLabel, nearLeft && styles.markerLabelLeft, nearRight && styles.markerLabelRight, nearBottom && styles.markerLabelTop]
                    .filter(Boolean)
                    .join(" ")}
                >
                  {marker.label}
                </span>
              )}
            </span>
          );
        })}

        {keyboardCursor && (
          <span className={styles.keyboardCursor} style={{ left: `${keyboardCursor.x * 100}%`, top: `${keyboardCursor.y * 100}%` }} aria-hidden="true" />
        )}
      </div>

      {/* Inline instance: a single explicit trigger into the fullscreen
          zoom space — the ONLY entry point on a touch device (no wheel
          gesture exists there), and a clearly discoverable one on desktop
          too rather than relying solely on an implicit scroll gesture. */}
      {!fullscreen && onOpenFullscreen && (
        <button type="button" className={styles.expandButton} onClick={onOpenFullscreen} aria-label="Zoom in on the map">
          🔍
        </button>
      )}

      {/* Fullscreen instance: the real zoom controls, same shape the old
          inline version had — just with room to actually use them. */}
      {fullscreen && zoomInteractive && (
        <div className={styles.zoomControls} role="group" aria-label="Zoom" onClick={(event) => event.stopPropagation()}>
          <button type="button" className={styles.zoomButton} disabled={effectiveZoom <= MIN_ZOOM} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))} aria-label="Zoom out">
            −
          </button>
          <span className={styles.zoomLevel}>{Math.round(effectiveZoom * 100)}%</span>
          <button type="button" className={styles.zoomButton} disabled={effectiveZoom >= MAX_ZOOM} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))} aria-label="Zoom in">
            +
          </button>
        </div>
      )}

      {fullscreen && onCloseFullscreen && (
        <button type="button" className={styles.closeButton} onClick={onCloseFullscreen} aria-label="Close zoomed map">
          × Close
        </button>
      )}

      {showHint && zoomInteractive && (
        <p className={styles.gestureHint} aria-hidden="true">
          Scroll or pinch to zoom · Drag to pan · Tap to place
        </p>
      )}

      {keyboardCursor && (
        <p className={styles.keyboardCursorStatus} role="status" aria-live="polite">
          Keyboard cursor: {Math.round(keyboardCursor.x * 100)}%, {Math.round(keyboardCursor.y * 100)}% — Enter to place · Esc to cancel
        </p>
      )}
    </div>
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
