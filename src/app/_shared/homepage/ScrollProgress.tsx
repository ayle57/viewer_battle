"use client";

import { motion, useScroll, useSpring } from "motion/react";
import styles from "./ScrollProgress.module.css";

/**
 * A thin gradient line, fixed to the top edge, whose width tracks how
 * far down the homepage the visitor has scrolled — the one piece of
 * "scroll animation" that isn't a reveal at all, just a direct, always-
 * live readout of the visitor's own scroll position (the same idea as a
 * live show's runtime bar). `useSpring` smooths the raw scroll fraction
 * so it glides rather than jumps a pixel per wheel tick.
 *
 * Deliberately NOT gated behind `useReducedMotion()`, unlike everything
 * else in src/app/_shared/motion: this doesn't play on its own or move
 * independently of the visitor's own input the way a parallax drift or
 * an entrance does — it's a 1:1 response to scrolling, the same
 * category of motion as the browser's native scrollbar thumb, which
 * `prefers-reduced-motion` was never meant to suppress.
 */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 200, damping: 30, restDelta: 0.001 });

  return <motion.div className={styles.bar} style={{ scaleX }} aria-hidden="true" />;
}
