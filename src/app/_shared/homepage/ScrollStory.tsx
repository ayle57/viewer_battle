"use client";

import { motion, useReducedMotion } from "motion/react";
import { Badge } from "@/ui";
import { fadeUp, popIn, slideFrom, staggerContainer, withStagger } from "@/app/_shared/motion/variants";
import { useScrollReveal } from "@/app/_shared/motion/useScrollReveal";
import type { GameDefinition } from "@/domain/game";
import styles from "./ScrollStory.module.css";

/**
 * The scroll IS the pitch, section by section — not a features list under
 * the hero. Each section reveals once, on entry — 30% of it visible,
 * via `useScrollReveal`'s own `IntersectionObserver` driving a plain
 * `animate={inView ? "show" : "hidden"}` toggle, NOT Framer Motion's own
 * `whileInView`. That was the original implementation; a real headless-
 * browser check found it never actually applied its `initial` (hidden)
 * state at all here — elements sat fully visible from first paint with
 * no inline style, and "revealing" later just silently settled to the
 * same already-visible look, so nothing ever visibly appeared. `animate`
 * (no `whileInView`) doesn't have that problem, confirmed the same way —
 * see useScrollReveal.ts's own doc comment.
 *
 * Uses the exact same `useReducedMotion()`-gated variants the hero
 * (CinematicHero.tsx) does, so the whole page shares one motion
 * vocabulary instead of the intro being the only "designed" moment.
 * Nothing here reads real game/session state — same posture as
 * CinematicHero's LiveBoardDemo — except `games`, the one real, server-
 * sourced piece (src/domain/game/registry.ts via HomePage's own
 * `listGameDefinitions()` call), passed down as plain data since a
 * Server Component can't itself run inside `motion.div`.
 *
 * There's no continuous scroll-linked parallax here — three separate
 * attempts (Framer Motion's `useScroll`/`useTransform`, a hand-rolled
 * scroll listener, then GSAP ScrollTrigger) all got built and then
 * explicitly dropped again; the entrance reveal below is the one motion
 * this page commits to.
 */
export function ScrollStory({ games }: { games: GameDefinition[] }) {
  const reduced = useReducedMotion() ?? false;

  return (
    <div className={styles.story}>
      <RunTheShowSection reduced={reduced} />
      <TeamsLiveSection reduced={reduced} />
      <CountdownSection reduced={reduced} />
      <DisplayFrameSection reduced={reduced} />
      <GamesSection reduced={reduced} games={games} />
    </div>
  );
}

/** The `ref` sits on the kicker — the first of the three lines to reach 30% visible — and drives all three; they're close enough together that using one line's timing for the group is visually indistinguishable from tracking each separately. */
function SectionHeading({ kicker, title, tagline, reduced }: { kicker: string; title: string; tagline: string; reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLParagraphElement>();

  return (
    <>
      <motion.p ref={ref} className={styles.kicker} initial="hidden" animate={inView ? "show" : "hidden"} variants={fadeUp(reduced)}>
        {kicker}
      </motion.p>
      <motion.h2
        className={styles.title}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        variants={fadeUp(reduced, { delay: 0.06 })}
      >
        {title}
      </motion.h2>
      <motion.p
        className={styles.tagline}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        variants={fadeUp(reduced, { delay: 0.12 })}
      >
        {tagline}
      </motion.p>
    </>
  );
}

function RunTheShowSection({ reduced }: { reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLDivElement>();

  return (
    <section className={styles.section} aria-label="Run the show">
      <SectionHeading
        kicker="For the Host"
        title="Run the show"
        tagline="Pick the question, watch the buzz, judge the answer — you're the one calling it, live."
        reduced={reduced}
      />
      <motion.div
        ref={ref}
        className={styles.runShow}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        variants={staggerContainer(reduced, { stagger: 0.15, delayChildren: 0.1 })}
      >
        <motion.div className={styles.runShowStep} variants={popIn(reduced)}>
          <Badge variant="host" size="md">
            HOST
          </Badge>
        </motion.div>
        <span className={styles.runShowArrow} aria-hidden="true">
          →
        </span>
        <motion.div className={styles.runShowStep} variants={fadeUp(reduced)}>
          <span className={styles.runShowChip}>&ldquo;Capital of Japan?&rdquo;</span>
        </motion.div>
        <span className={styles.runShowArrow} aria-hidden="true">
          →
        </span>
        <motion.div className={styles.runShowStep} variants={popIn(reduced)}>
          <span className={styles.judgeCheck} aria-hidden="true">
            ✓
          </span>
          <span className={styles.runShowChip}>Judged correct</span>
        </motion.div>
      </motion.div>
    </section>
  );
}

function TeamsLiveSection({ reduced }: { reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLDivElement>();

  return (
    <section className={styles.section} aria-label="Your teams are live">
      <SectionHeading
        kicker="For the teams"
        title="Your teams are live"
        tagline="Two teams of two, buzzing in for real — not a poll, not a chat command, a real race to answer first."
        reduced={reduced}
      />
      <div ref={ref} className={styles.teamsRow}>
        <motion.div
          className={[styles.teamPanel, styles.teamPanelA].join(" ")}
          initial="hidden"
          animate={inView ? "show" : "hidden"}
          variants={slideFrom("left", reduced)}
        >
          TEAM A
        </motion.div>
        <motion.span
          className={styles.teamsVs}
          initial="hidden"
          animate={inView ? "show" : "hidden"}
          variants={popIn(reduced, { delay: 0.3 })}
        >
          VS
        </motion.span>
        <motion.div
          className={[styles.teamPanel, styles.teamPanelB].join(" ")}
          initial="hidden"
          animate={inView ? "show" : "hidden"}
          variants={slideFrom("right", reduced)}
        >
          TEAM B
        </motion.div>
      </div>
    </section>
  );
}

function CountdownSection({ reduced }: { reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLDivElement>();

  return (
    <section className={styles.section} aria-label="Every second counts">
      <SectionHeading
        kicker="For the tension"
        title="Every second counts"
        tagline="The floor opens, both teams see it happen, and whoever buzzes first gets the shot."
        reduced={reduced}
      />
      <motion.p className={styles.countdownQuestion} initial="hidden" animate={inView ? "show" : "hidden"} variants={fadeUp(reduced)}>
        The chemical symbol for gold?
      </motion.p>
      <motion.div
        ref={ref}
        className={styles.countdownRow}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        variants={staggerContainer(reduced, { stagger: 0.35, delayChildren: 0.15 })}
      >
        <motion.span variants={popIn(reduced)}>3</motion.span>
        <motion.span variants={popIn(reduced)}>2</motion.span>
        <motion.span variants={popIn(reduced)}>1</motion.span>
        <motion.span className={styles.countdownBuzz} variants={popIn(reduced, { scale: 0.5 })}>
          BUZZ!
        </motion.span>
      </motion.div>
    </section>
  );
}

/**
 * The one section that used to be a single flat lump — the frame popped
 * in as one unit and everything inside it (the LIVE badge, the
 * ViewerBattle label, the score) was just static content riding along,
 * unlike every other section here (RunTheShow/TeamsLive/Countdown/Games)
 * where the individual pieces each get their own beat. `withStagger`
 * (variants.ts) is what makes both true at once: the frame still pops in
 * as a whole ("a monitor switching on"), and its own contents THEN build
 * in on top of that, each with its own beat, same vocabulary as
 * everywhere else on this page.
 */
function DisplayFrameSection({ reduced }: { reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLDivElement>();

  return (
    <section className={styles.section} aria-label="Built for the stream">
      <SectionHeading
        kicker="For the audience"
        title="Built for the stream"
        tagline="Drop the Display screen straight into OBS — full-screen, 16:9, readable from across the room."
        reduced={reduced}
      />
      <motion.div
        ref={ref}
        className={styles.displayFrame}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        variants={withStagger(popIn(reduced, { scale: 0.94 }), reduced, { stagger: 0.15, delayChildren: 0.2 })}
      >
        <motion.span className={styles.displayLive} variants={popIn(reduced)}>
          <span className={styles.displayLiveDot} aria-hidden="true" />
          LIVE
        </motion.span>
        <motion.span className={styles.displayLabel} variants={fadeUp(reduced, { y: 10 })}>
          ViewerBattle
        </motion.span>
        <motion.div className={styles.displayScoreRow} variants={popIn(reduced, { scale: 0.85 })}>
          <span className={styles.displayScoreA}>240</span>
          <span>—</span>
          <span className={styles.displayScoreB}>210</span>
        </motion.div>
      </motion.div>
    </section>
  );
}

function GamesSection({ reduced, games }: { reduced: boolean; games: GameDefinition[] }) {
  const { ref, inView } = useScrollReveal<HTMLDivElement>();

  return (
    <section className={styles.section} aria-label="Choose your game">
      <SectionHeading
        kicker="For the show"
        title="Choose your game"
        tagline="Mini Jeopardy is live today. The lineup grows from here — same room, same host, same stream."
        reduced={reduced}
      />
      <motion.div
        ref={ref}
        className={styles.gameCards}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        variants={staggerContainer(reduced, { stagger: 0.12, delayChildren: 0.1 })}
      >
        {games.map((game) => (
          <motion.div className={styles.gameCard} key={game.id} variants={fadeUp(reduced)}>
            <Badge variant="success">Available</Badge>
            <p className={styles.gameCardName}>{game.label}</p>
            {game.meta && <p className={styles.gameCardMetaTag}>{game.meta}</p>}
            {game.description && <p className={styles.gameCardDescription}>{game.description}</p>}
          </motion.div>
        ))}
        <motion.div className={[styles.gameCard, styles.gameCardComingSoon].join(" ")} variants={fadeUp(reduced)}>
          <Badge variant="neutral">Coming soon</Badge>
          <p className={styles.gameCardName}>More games</p>
          <p className={styles.gameCardDescription}>New formats are on the way — same host, same room, same stream.</p>
        </motion.div>
      </motion.div>
    </section>
  );
}
