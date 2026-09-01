/**
 * The minimum viable pen controls the product brief asked for ("couleur,
 * taille du trait, clear canvas") — a small fixed palette + a few width
 * steps, not a full picker. Shared between PlayerDrawingPanel's toolbar
 * and anywhere else that ever needs the same defaults.
 */
export const PEN_COLORS = ["#f5f5f5", "#ff6b6b", "#4dabf7", "#51cf66", "#ffd43b"] as const;
export const PEN_WIDTHS = [3, 6, 12] as const;
