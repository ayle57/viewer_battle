"use client";

import Link from "next/link";
import { redirect } from "next/navigation";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { Badge, Button } from "@/ui";
import { listGameDefinitions } from "@/domain/game";
import { fadeUp, staggerContainer } from "@/app/_shared/motion/variants";
import { StudioBreadcrumb } from "./_shared/StudioBreadcrumb";
import styles from "./page.module.css";

/**
 * Presented as future capability, never as a broken button — no engine
 * exists for any of these yet (see AGENTS.md "Game Kernel contract"'s
 * planned-engine list). A static, purely presentational array: adding a
 * real engine later means adding it to src/domain/game/registry.ts, which
 * shows up in the "live" grid below automatically — this list is not
 * wired to that registry and never claims to be.
 */
const COMING_SOON_GAMES = [
  { label: "Guess the Music", meta: "Both teams submit, host judges" },
  { label: "Top 5", meta: "Rank it, race the clock" },
  { label: "Drawing", meta: "Timed sketch, teams guess" },
];

/**
 * The one place a content-capable `GameEngine.id` (src/domain/game/
 * registry.ts) maps to its own Content Studio route — future-proofing
 * per product brief "Show Preparation" section 14: adding a second
 * content-capable game means adding one entry here (and its own
 * `/host/content/<game>` route/editor), never a scattered
 * `if (game === "board-question")` across this component. Route slugs
 * are display-friendly ("jeopardy"), not required to match the engine id
 * ("board-question") — the map is exactly what bridges that gap.
 */
const CONTENT_ROUTES: Record<string, string> = {
  "board-question": "/host/content/jeopardy",
  geoguessr: "/host/content/geoguessr",
};

export default function ContentStudioHome() {
  const games = listGameDefinitions();
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  // Skip the "pick a game" grid entirely when there's only one real
  // choice to make — today that's every real Host, since Jeopardy is
  // the only content-capable game, and landing on a grid with one live
  // card and a wall of "Coming soon" placeholders before "Your Shows"
  // is a genuinely pointless extra click for that Host. Registry-driven
  // (`hasContentStudio` + CONTENT_ROUTES), not `if game ===
  // "board-question"` — the moment a second content-capable game gets
  // its own CONTENT_ROUTES entry, this naturally starts showing the
  // grid below instead of redirecting, no further change needed here.
  const manageableGames = games.filter((game) => game.hasContentStudio && CONTENT_ROUTES[game.id]);
  if (manageableGames.length === 1) {
    redirect(CONTENT_ROUTES[manageableGames[0]!.id]!);
  }

  return (
    <>
      <StudioBreadcrumb crumbs={[{ label: "Content Studio" }]} />

      <div className={styles.intro}>
        <span className={styles.eyebrow}>Content Studio</span>
        <h1 className={styles.title}>Build the games your audience will remember.</h1>
        <p className={styles.subtitle}>Prepare boards, categories, and questions now — start the show later, in seconds.</p>
      </div>

      <motion.div className={styles.grid} variants={staggerContainer(reduced)} initial="hidden" animate="show">
        {games.map((game) =>
          game.hasContentStudio ? (
            <motion.div key={game.id} variants={fadeUp(reduced)} className={`${styles.gameCard} ${styles.gameCardLive}`}>
              <div>
                <p className={styles.gameCardTitle}>{game.label}</p>
                {game.meta && <p className={styles.gameCardSub}>{game.meta}</p>}
              </div>
              <ul className={styles.featureList}>
                <li>Question board</li>
                <li>Categories</li>
                <li>Playlists</li>
              </ul>
              <div className={styles.statusRow}>
                <Badge variant="success" dot>
                  Ready
                </Badge>
                {CONTENT_ROUTES[game.id] ? (
                  <Link href={CONTENT_ROUTES[game.id]!}>
                    <Button size="sm">Manage content</Button>
                  </Link>
                ) : (
                  <Button size="sm" disabled>
                    Manage content
                  </Button>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div key={game.id} variants={fadeUp(reduced)} className={`${styles.gameCard} ${styles.gameCardComingSoon}`}>
              <div>
                <p className={styles.gameCardTitle}>{game.label}</p>
                {game.meta && <p className={styles.gameCardSub}>{game.meta}</p>}
              </div>
              <p className={styles.gameCardSub}>No content authoring yet — this game plays from built-in content only.</p>
              <div className={styles.statusRow}>
                <span className={styles.comingSoonTag}>Coming soon</span>
              </div>
            </motion.div>
          ),
        )}

        {COMING_SOON_GAMES.map((game) => (
          <motion.div key={game.label} variants={fadeUp(reduced)} className={`${styles.gameCard} ${styles.gameCardComingSoon}`}>
            <div>
              <p className={styles.gameCardTitle}>{game.label}</p>
              <p className={styles.gameCardSub}>{game.meta}</p>
            </div>
            <p className={styles.gameCardSub}>New formats for the same room, same stream.</p>
            <div className={styles.statusRow}>
              <span className={styles.comingSoonTag}>Coming soon</span>
            </div>
          </motion.div>
        ))}
      </motion.div>
    </>
  );
}
