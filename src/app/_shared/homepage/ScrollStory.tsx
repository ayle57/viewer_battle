"use client";

import Link from "next/link";
import { motion } from "motion/react";
import { useReducedMotionSafe } from "@/app/_shared/motion/useReducedMotionSafe";
import { Badge, BuzzButton } from "@/ui";
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
 * vocabulary. Nothing here reads real game/session state — same posture
 * as CinematicHero's LiveBoardDemo — except `games`, the one real,
 * server-sourced piece (src/domain/game/registry.ts via HomePage's own
 * `listGameDefinitions()` call), passed down as plain data since a
 * Server Component can't itself run inside `motion.div`.
 */
export function ScrollStory({ games }: { games: GameDefinition[] }) {
  const reduced = useReducedMotionSafe(); // hydration-safe — see that hook's own doc comment

  return (
    <div className={styles.story}>
      <HowItWorksSection reduced={reduced} />
      <RunTheShowSection reduced={reduced} />
      <TeamsLiveSection reduced={reduced} />
      <CountdownSection reduced={reduced} />
      <DisplayFrameSection reduced={reduced} />
      <GamesSection reduced={reduced} games={games} />
      <SiteFooter />
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
      <motion.h2 className={styles.title} initial="hidden" animate={inView ? "show" : "hidden"} variants={fadeUp(reduced, { delay: 0.08 })}>
        {title}
      </motion.h2>
      <motion.p className={styles.tagline} initial="hidden" animate={inView ? "show" : "hidden"} variants={fadeUp(reduced, { delay: 0.16 })}>
        {tagline}
      </motion.p>
    </>
  );
}

const HOW_IT_WORKS: { title: string; body: string }[] = [
  {
    title: "Open the control room",
    body: "Pick a format, load your questions, and get a session code. Nothing to install — it runs in a browser tab.",
  },
  {
    title: "Your community picks a side",
    body: "Viewers join from a link as Team A or Team B. Two players per team hold the buzzers; everyone else watches along.",
  },
  {
    title: "Play it on stream",
    body: "Drop one browser source into OBS for the scoreboard. You host, they buzz, the score updates on every screen at once.",
  },
];

function HowItWorksSection({ reduced }: { reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLDivElement>();

  return (
    <section className={styles.section} aria-label="How it works">
      <SectionHeading
        kicker="Get started"
        title="Live in three steps"
        tagline="No sign-up, no software, no wrangling a bot. From idea to a game on your stream in a couple of minutes."
        reduced={reduced}
      />
      <motion.div
        ref={ref}
        className={styles.steps}
        initial="hidden"
        animate={inView ? "show" : "hidden"}
        variants={staggerContainer(reduced, { stagger: 0.12, delayChildren: 0.1 })}
      >
        {HOW_IT_WORKS.map((step, index) => (
          <motion.div key={step.title} className={styles.step} variants={fadeUp(reduced)}>
            <span className={styles.stepNumber} aria-hidden="true">
              {index + 1}
            </span>
            <p className={styles.stepTitle}>{step.title}</p>
            <p className={styles.stepBody}>{step.body}</p>
          </motion.div>
        ))}
      </motion.div>
    </section>
  );
}

function RunTheShowSection({ reduced }: { reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLDivElement>();

  return (
    <section className={styles.section} aria-label="Run the show">
      <SectionHeading
        kicker="For the host"
        title="You're the one calling it"
        tagline="Reveal the question, watch both teams race to buzz, judge the answer. Steal, skip, or end the game early — every call is yours, live."
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
        <motion.span className={styles.stealChip} variants={fadeUp(reduced)}>
          steal on a miss
        </motion.span>
      </motion.div>
    </section>
  );
}

function TeamsLiveSection({ reduced }: { reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLDivElement>();

  return (
    <section className={styles.section} aria-label="Your teams are live">
      <SectionHeading
        kicker="For the players"
        title="Real buzzers, real stakes"
        tagline="Two against two, first to the button. Not a poll, not a chat command — an actual race, with a steal on a miss and a running match score across every game you play."
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
        <motion.div
          className={styles.teamsBuzzer}
          initial="hidden"
          animate={inView ? "show" : "hidden"}
          variants={popIn(reduced, { delay: 0.25, scale: 0.5 })}
        >
          <BuzzButton variant="teamA" tabIndex={-1} aria-hidden="true">
            Buzz
          </BuzzButton>
        </motion.div>
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
        title="The floor opens"
        tagline="The moment a question drops, both teams see it at the same instant. Whoever buzzes first gets the shot — and the whole room watches it land."
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
 * in as one unit and everything inside it was just static content riding
 * along, unlike every other section here where the individual pieces
 * each get their own beat. `withStagger` (variants.ts) is what makes both
 * true at once: the frame still pops in as a whole ("a monitor switching
 * on"), and its own contents THEN build in on top of that.
 */
function DisplayFrameSection({ reduced }: { reduced: boolean }) {
  const { ref, inView } = useScrollReveal<HTMLDivElement>();

  return (
    <section className={styles.section} aria-label="Built for the stream">
      <SectionHeading
        kicker="For the audience"
        title="One source into OBS"
        tagline="A 16:9 scoreboard that reads from across the room — score, question, who's up. Add the link once; it reconnects on its own if OBS restarts mid-show."
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
        <motion.div className={styles.displayTeams} variants={fadeUp(reduced, { y: 8 })}>
          <span>Team A</span>
          <span>Team B</span>
        </motion.div>
        <motion.div className={styles.displayScoreRow} variants={popIn(reduced, { scale: 0.85 })}>
          <span className={styles.displayScoreA}>240</span>
          <span>—</span>
          <span className={styles.displayScoreB}>210</span>
        </motion.div>
        <motion.p className={styles.displayQuestion} variants={fadeUp(reduced, { y: 8 })}>
          Team A is answering&hellip;
        </motion.p>
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
        tagline="Every format below is live today — same room, same host, same stream, one game after another."
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
          <p className={styles.gameCardName}>More formats</p>
          <p className={styles.gameCardDescription}>New games land on this list as they ship — same host, same room, same stream.</p>
        </motion.div>
      </motion.div>
    </section>
  );
}

/**
 * A plain, static footer — no motion, no reveal. It's below the fold by
 * definition and its whole job is "you scrolled this far, here are the
 * three doors back in." Kept in ScrollStory (not the root layout) because
 * it's specific to this page's pitch, same reasoning as every other
 * section here.
 */
function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <p className={styles.footerWordmark}>VIEWERBATTLE</p>
      <p className={styles.footerTagline}>A live 2v2 gameshow platform for your stream.</p>
      <nav className={styles.footerLinks} aria-label="Get started">
        <Link href="/host" className={styles.footerLink}>
          Host a game
        </Link>
        <Link href="/player" className={styles.footerLink}>
          Join a game
        </Link>
        <Link href="/display" className={styles.footerLink}>
          Open a Display
        </Link>
      </nav>
      <p className={styles.footerNote}>No account needed to play.</p>
    </footer>
  );
}
