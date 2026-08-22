/**
 * Normalized [0,1]x[0,1] Euclidean distance (src/domain/game/geoGuessr's
 * own engine math) formatted for display — a percentage of the image's
 * diagonal, NOT a fabricated real-world unit. See
 * src/domain/game/geoGuessr/types.ts's top comment: the source maps are
 * streamer-provided images (fantasy/game worlds), which have no inherent
 * real-world scale, so showing "842 m" would be a made-up number. Shared
 * by every panel (Player/Host/Display) that shows a round result, so the
 * exact same number reads the exact same way everywhere.
 */
/** `null` means that team never answered at all — only reachable via a countdown forcing the round closed while they had zero proposals queued (GeoRoundResult's own doc comment). */
export function formatDistance(distance: number | null): string {
  if (distance === null) return "No guess";
  return `${(distance * 100).toFixed(1)}% off`;
}

// formatCountdown moved to src/app/_shared/formatCountdown.ts — it was
// never GeoGuessr-specific (pure M:SS math), and BoardQuestion's own
// countdown UI needs the identical thing now (src/domain/game/countdown.ts's
// own doc comment).
