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
export function formatDistance(distance: number): string {
  return `${(distance * 100).toFixed(1)}% off`;
}
