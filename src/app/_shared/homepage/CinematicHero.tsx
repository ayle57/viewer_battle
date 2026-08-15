"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Badge, BuzzButton, ScoreDisplay } from "@/ui";
import { fadeUp, popIn, staggerContainer } from "@/app/_shared/motion/variants";
import { LetterReveal } from "@/app/_shared/motion/LetterReveal";
import { useScrollReveal } from "@/app/_shared/motion/useScrollReveal";
import { CURTAIN_TOTAL_SECONDS } from "@/app/_shared/motion/curtainTiming";
import styles from "./CinematicHero.module.css";

/**
 * The first five seconds. A cold open, not a static hero: the wordmark
 * punches in, the headline lands in two beats, the CTAs arrive with
 * weight, then the actual product — HOST -> QUESTION -> BUZZ -> ANSWER ->
 * SCORE — builds itself in front of you using the real `BuzzButton` /
 * `ScoreDisplay` components (see the file-level comment further down for
 * why those specific two). Once the sequence lands, it doesn't go
 * static: the buzz ring and the score's "+100" keep recurring on a slow,
 * deliberate loop (see CinematicHero.module.css) — "this show is live,"
 * not "this animation finished."
 *
 * The wordmark/headline/CTAs fire on plain `animate` (unconditional) —
 * they're always the top of the page, nothing to wait for. Every one of
 * their delays adds `CURTAIN_TOTAL_SECONDS` on top of its own relative
 * timing: this component mounts the INSTANT the page loads, which is
 * also the instant the launch curtain (PageChangeCurtain.tsx) starts
 * covering the screen — without this offset the whole cold-open plays
 * out hidden behind the curtain, and the visitor only ever sees the
 * already-finished state once it lifts. `LiveBoardDemo` further down
 * doesn't need the offset — it uses `useScrollReveal` (a real
 * `IntersectionObserver`, not Framer Motion's own `whileInView` — see
 * that hook's doc comment for why: `whileInView` was verified, in a real
 * browser, to never actually apply its hidden state here, so nothing
 * ever visibly appeared) so it only ever plays once genuinely scrolled
 * into view, long after the curtain is gone.
 *
 * `useReducedMotion()` is read once, here, and threaded through every
 * variant builder — with it true, every entrance collapses to a ~150ms
 * cross-fade with no travel AND no delay (`fadeUp`/`popIn`/`letterReveal`
 * all zero their `delay` under reduced motion — see variants.ts), so the
 * curtain offset above is a no-op for those visitors, not an extra wait.
 * (src/ui/tokens.css does the same for the pure-CSS loops this component
 * also uses: BuzzButton's own pulse, the buzz ring, the score pop — none
 * of those need a JS gate, only what Framer Motion itself drives does.)
 *
 * A client component by necessity (Framer Motion needs the DOM/JS to
 * orchestrate this), but the ONLY client boundary on the homepage — the
 * copy, the games list, and the rest of the page (ScrollStory.tsx) stay
 * server-rendered. No socket, no tRPC, no identity: this sequence is
 * illustrative, wired to nothing real, on purpose (see the doc comment
 * further down on `BuzzButton`/`ScoreDisplay` being the real components
 * used for real, everything else about the scene being staged).
 */
export function CinematicHero() {
  const reduced = useReducedMotion() ?? false;
  const atmosphereRef = useRef<HTMLDivElement>(null);

  // A cursor-reactive spotlight in the atmosphere layer — pure DOM/CSS,
  // no React state (a `--vb-spot-x/y` custom property mutated directly
  // on the element), so it never re-renders the tree on every
  // pointermove. Never attached at all under reduced motion or on a
  // coarse (touch) pointer — this is a hover embellishment, not content,
  // so on devices that can't hover it simply doesn't exist rather than
  // sitting there static.
  useEffect(() => {
    if (reduced) return;
    if (typeof window !== "undefined" && !window.matchMedia("(pointer: fine)").matches) return;
    const el = atmosphereRef.current;
    if (!el) return;
    function handlePointerMove(e: PointerEvent) {
      const rect = el!.getBoundingClientRect();
      el!.style.setProperty("--vb-spot-x", `${((e.clientX - rect.left) / rect.width) * 100}%`);
      el!.style.setProperty("--vb-spot-y", `${((e.clientY - rect.top) / rect.height) * 100}%`);
    }
    el.addEventListener("pointermove", handlePointerMove);
    return () => el.removeEventListener("pointermove", handlePointerMove);
  }, [reduced]);

  return (
    <>
      <div className={styles.atmosphereWrap} ref={atmosphereRef}>
        {/* Pure backdrop — a broadcast-studio depth cue, not content: two
            slow, low-opacity role-colored glows drifting independently
            (host gold, team-A blue — the two colors this scene's cast
            actually uses), a cursor-following spotlight, a faint
            technical grid, and a vignette to keep the edges calm. Every
            layer is `aria-hidden`, transform/opacity-only, and the drift
            keyframes are already covered by tokens.css's blanket
            `prefers-reduced-motion` rule — nothing extra to gate here
            (the spotlight gates itself, see the effect above). */}
        <div className={styles.atmosphere} aria-hidden="true">
          <span className={styles.glowHost} />
          <span className={styles.glowTeamA} />
          <span className={styles.spotlight} />
          <span className={styles.grid} />
          <span className={styles.vignette} />
        </div>

        <section className={styles.hero}>
          {/* Shares its view-transition-name with each product page's own
              small header brand mark (see tokens.css's
              .vb-wordmark-transition) — clicking through to /host,
              /player, or /display morphs this big wordmark into that
              small one natively, no JS. The letters themselves build in
              one by one via `LetterReveal` — the same typography-arrival
              primitive PageChangeCurtain.tsx uses for its own wordmark,
              so the homepage's opening beat and every later page-change
              read as one motion idea. */}
          <p className={`${styles.wordmark} vb-wordmark-transition`}>
            <LetterReveal
              text="VIEWERBATTLE"
              reduced={reduced}
              stagger={0.032}
              delayChildren={CURTAIN_TOTAL_SECONDS + 0.1}
              letterDuration={0.45}
            />
          </p>

          <h1 className={styles.headline}>
            <motion.span
              className={styles.headlineLine}
              initial="hidden"
              animate="show"
              variants={fadeUp(reduced, { delay: CURTAIN_TOTAL_SECONDS + 0.5 })}
            >
              Live games.
            </motion.span>
            <motion.span
              className={styles.headlineLine}
              initial="hidden"
              animate="show"
              variants={fadeUp(reduced, { delay: CURTAIN_TOTAL_SECONDS + 0.7 })}
            >
              Real competition.
            </motion.span>
          </h1>

          <motion.p
            className={styles.subtitle}
            initial="hidden"
            animate="show"
            variants={fadeUp(reduced, { delay: CURTAIN_TOTAL_SECONDS + 0.95 })}
          >
            A live 2v2 gameshow platform for your stream — host a round, get your community buzzing in, and watch the
            score update in real time, together.
          </motion.p>

          <motion.div
            className={styles.ctaRow}
            initial="hidden"
            animate="show"
            variants={popIn(reduced, { delay: CURTAIN_TOTAL_SECONDS + 1.2 })}
          >
            <Link href="/host" className={[styles.cta, styles.ctaPrimary].join(" ")}>
              Host a Game
            </Link>
            <Link href="/player" className={[styles.cta, styles.ctaSecondary].join(" ")}>
              Join a Game
            </Link>
          </motion.div>

          <motion.div initial="hidden" animate="show" variants={fadeUp(reduced, { delay: CURTAIN_TOTAL_SECONDS + 1.4 })}>
            <Link href="/display" className={styles.watchLink}>
              Watch on a Display →
            </Link>
          </motion.div>
        </section>
      </div>

      <LiveBoardDemo reduced={reduced} />
    </>
  );
}

/**
 * Not a screenshot, not a mockup — the ACTUAL `BuzzButton` and
 * `ScoreDisplay` from the UI Kit (src/ui), the exact same components a
 * real Host/Player/Display screen renders, staged as a five-beat
 * construction (HOST -> QUESTION -> BUZZ -> ANSWER -> SCORE) instead of
 * appearing all at once. Every illustrative piece a real BuzzButton/
 * ScoreDisplay would need a live socket for is faked as plain,
 * non-interactive markup (`aria-hidden`, no onClick) — there is no path
 * from this component to a `game:action` no matter what future edits do
 * to it.
 *
 * A self-contained scene: `useScrollReveal` is the one trigger (a real
 * `IntersectionObserver`, 30% visible), and every beat below is a plain
 * `variants` child with no trigger of its own — Framer Motion propagates
 * the parent's hidden/show state straight through, so the five-beat
 * build only ever plays once the strip is actually scrolled into view,
 * not blind on page mount (see the file-level comment). `staggerContainer`
 * owns the beat-to-beat timing; each beat's own `delay` (the Buzz beat's
 * nested BuzzButton pop) is still relative to ITS OWN arrival, not to
 * the page.
 *
 * The buzz ring / score "+100" loops (CinematicHero.module.css) are
 * plain CSS `animation`s, which start counting their `animation-delay`
 * from element mount — decoupled from `inView`, which can flip true any
 * time after that. Reusing `inView` directly as the `.armed` class
 * (rather than a separate flag) bridges the two: it's already a one-way
 * "has this ever been true" latch — see useScrollReveal.ts — exactly
 * when the strip actually becomes visible, and the CSS only lets those
 * two loops start once `.armed` is present — so the first ring/pop still
 * lands right as the beats finish building, whether that's one second
 * after mount or ten.
 */
function LiveBoardDemo({ reduced }: { reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLElement>();

  return (
    <motion.section
      ref={ref}
      className={`${styles.demo} ${inView ? styles.armed : ""}`}
      aria-label="ViewerBattle, live"
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      variants={staggerContainer(reduced, { stagger: 0.22, delayChildren: 0.1 })}
    >
      <motion.div className={styles.demoBeat} variants={popIn(reduced)}>
        <p className={styles.demoLabel}>Host</p>
        <div className={styles.demoHost}>
          <Badge variant="host" size="md">
            HOST
          </Badge>
          <span className={styles.demoHostName}>@streamer</span>
        </div>
      </motion.div>

      <span className={styles.demoArrow} aria-hidden="true">
        →
      </span>

      <motion.div className={styles.demoBeat} variants={fadeUp(reduced)}>
        <p className={styles.demoLabel}>Question</p>
        <div className={styles.demoQuestion}>
          <span>Capital of Japan?</span>
          <span className={styles.demoCursor} aria-hidden="true" />
        </div>
      </motion.div>

      <span className={styles.demoArrow} aria-hidden="true">
        →
      </span>

      <motion.div className={styles.demoBeat} variants={fadeUp(reduced)}>
        <p className={styles.demoLabel}>Buzz</p>
        <div className={styles.demoBuzzWrap}>
          <motion.div className={styles.demoBuzz} variants={popIn(reduced, { delay: 0.15, scale: 0.5 })}>
            <BuzzButton variant="teamA" tabIndex={-1} aria-hidden="true">
              Buzz
            </BuzzButton>
          </motion.div>
          <span className={styles.demoBuzzRing} aria-hidden="true" />
        </div>
      </motion.div>

      <span className={styles.demoArrow} aria-hidden="true">
        →
      </span>

      <motion.div className={styles.demoBeat} variants={fadeUp(reduced)}>
        <p className={styles.demoLabel}>Answer</p>
        <div className={styles.demoAnswer}>&ldquo;Tokyo&rdquo;</div>
      </motion.div>

      <span className={styles.demoArrow} aria-hidden="true">
        →
      </span>

      <motion.div className={[styles.demoBeat, styles.demoScoreBeat].join(" ")} variants={popIn(reduced)}>
        <p className={styles.demoLabel}>Score</p>
        <div className={styles.demoScore}>
          <ScoreDisplay teamAName="Team A" teamAScore={240} teamBName="Team B" teamBScore={210} />
          <span className={styles.demoScorePop} aria-hidden="true">
            +100
          </span>
        </div>
      </motion.div>
    </motion.section>
  );
}
