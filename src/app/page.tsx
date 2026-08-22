import { listGameDefinitions } from "@/domain/game";
import { CinematicHero } from "@/app/_shared/homepage/CinematicHero";
import { ScrollStory } from "@/app/_shared/homepage/ScrollStory";
import { ScrollProgress } from "@/app/_shared/homepage/ScrollProgress";
import { AccountCorner } from "@/app/_shared/homepage/AccountCorner";
import styles from "./page.module.css";

/**
 * The real product entry point. Stays a Server Component (no
 * "use client" here) — `listGameDefinitions()` (src/domain/game/
 * registry.ts) is a pure, synchronous domain call, not a network
 * request, so the games list is already in the first response; no
 * loading state, no client fetch. The four client boundaries —
 * `ScrollProgress` (the top runtime bar), `CinematicHero` (the
 * first-five-seconds intro), `ScrollStory` (the section-by-section
 * pitch), and `AccountCorner` (a fixed top-right "Log in" badge — see
 * its own doc comment for why this replaced an earlier attempt at a
 * link jammed into the hero's own CTA row) — are isolated in
 * src/app/_shared/homepage/ specifically so this file stays legible as
 * "what the homepage IS" rather than "how it animates."
 *
 * No link to /dev anywhere on this page, deliberately — /dev is an
 * internal development environment, not part of the product experience
 * a client demo should ever surface (see AGENTS.md).
 */
export default function HomePage() {
  const games = listGameDefinitions();

  return (
    <main className={styles.page}>
      <ScrollProgress />
      <AccountCorner />
      <CinematicHero />
      <ScrollStory games={games} />
    </main>
  );
}
