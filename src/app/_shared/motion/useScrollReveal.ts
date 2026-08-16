"use client";

import { useEffect, useRef, useState } from "react";
import { isCurtainActive, subscribeCurtainActive } from "@/app/_shared/motion/curtainState";

/**
 * Replaces Framer Motion's own `whileInView` — verified, in a real
 * browser, to never actually apply its `initial` (hidden) state either
 * server-side or after hydration for this app's setup: elements sat at
 * the browser's default (fully visible, no inline style at all) from
 * first paint, and only ever gained a `style` attribute once genuinely
 * scrolled into view — at which point it settled straight to the SAME
 * visual state that was already showing, so nothing ever visibly faded
 * in. `animate`-driven motion (no `whileInView`) doesn't have this
 * problem — its `initial` state renders correctly, confirmed the same
 * way — so this hook does the "is it in view yet" part itself with a
 * plain `IntersectionObserver`, and callers drive `animate={inView ?
 * "show" : "hidden"}` instead of `whileInView`, keeping everything else
 * (the `variants`, `initial="hidden"`, reduced-motion handling) exactly
 * the same.
 *
 * `once` semantics are the only mode — matches `SCROLL_REVEAL_VIEWPORT`'s
 * old `{ once: true }`: the observer disconnects itself the first time
 * the element crosses `amount`, `inView` never goes back to false.
 *
 * `inView` starts `false` unconditionally, on both server and client —
 * NOT `typeof IntersectionObserver === "undefined"`, which looks like a
 * reasonable "no support, show it" fallback but is actually a hydration
 * bug: Node has no `IntersectionObserver` global either, so that check
 * resolved to `true` on every SSR pass, server-rendering "show" (fully
 * visible, no transform) while the client's own first render — the
 * browser DOES have `IntersectionObserver` — resolved the same check to
 * `false` and wanted "hidden". React's hydration then found a real
 * attribute mismatch, kept the server's already-visible markup rather
 * than patching it, and the element sat there fully shown from first
 * paint with the "reveal" animation never visibly playing — the EXACT
 * failure mode this hook's own top comment describes for `whileInView`,
 * except this was `animate`, unconditionally, for every single
 * `useScrollReveal` consumer, confirmed via a real hydration-mismatch
 * warning in the browser console. Genuine no-`IntersectionObserver`
 * environments are still handled — just from inside the effect below,
 * which only ever runs client-side post-hydration, so it can never
 * disagree with the server's render.
 *
 * Also gated on PageChangeCurtain.tsx via curtainState.ts: crossing
 * `amount` while the curtain is still covering the screen (a short
 * window, a tall zoom level, anything sitting inside the first
 * screenful) does NOT flip `inView` yet — only marks the crossing as
 * pending. The element only ever actually reveals once the curtain has
 * genuinely lifted, whether that's the same tick (curtain already gone)
 * or a beat later (curtain still closing). Without this, the crossing
 * happens, `inView` flips, and the whole animation plays out entirely
 * behind the curtain — by the time it lifts the element is already
 * sitting in its finished "shown" state with no visible entrance at all,
 * the same failure mode `whileInView` had (see this file's own doc
 * comment above) and CURTAIN_TOTAL_SECONDS exists to fix for
 * CinematicHero's unconditional cold-open (see curtainTiming.ts) — this
 * is the IntersectionObserver-driven equivalent, where a fixed delay
 * can't work because the crossing might not happen until long after the
 * curtain is gone.
 */
export function useScrollReveal<T extends HTMLElement>(amount = 0.3) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    // No-IntersectionObserver-support resolves here, inside the effect —
    // client-only, post-hydration — rather than in the initial `useState`
    // above, which would run during SSR too (see this file's own top
    // comment for why that's the bug this replaced).
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }

    let crossed = false;
    let unsubscribe = () => {};

    function reveal() {
      setInView(true);
      observer.disconnect();
      unsubscribe();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!crossed && entries.some((entry) => entry.isIntersecting)) {
          crossed = true;
          observer.disconnect();
          if (isCurtainActive()) {
            unsubscribe = subscribeCurtainActive(() => {
              if (!isCurtainActive()) reveal();
            });
          } else {
            reveal();
          }
        }
      },
      { threshold: amount },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [amount]);

  return { ref, inView };
}
