/**
 * The one shared fact about how long the launch curtain (PageChangeCurtain.tsx)
 * actually sits on screen — CinematicHero.tsx's own cold-open needs it to
 * delay its start until the curtain has genuinely lifted; without this,
 * the hero's entrance plays out entirely WHILE the curtain still covers
 * it (both mount at the same instant), so by the time the curtain lifts
 * the visitor just sees the finished state — no visible entrance at all,
 * same failure mode as the `whileInView` bug (see useScrollReveal.ts),
 * different cause. PageChangeCurtain.tsx imports the same two constants
 * so the two files can't drift out of sync.
 */
export const CURTAIN_HOLD_MS = 900;
export const CURTAIN_IRIS_SECONDS = 0.42;
/** Total time the curtain is actually on screen, in seconds — the delay CinematicHero's cold-open beats add on top of their own relative timing. */
export const CURTAIN_TOTAL_SECONDS = CURTAIN_HOLD_MS / 1000 + CURTAIN_IRIS_SECONDS;
