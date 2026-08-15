"use client";

import { useEffect, useRef, useState } from "react";

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
 */
export function useScrollReveal<T extends HTMLElement>(amount = 0.3) {
  const ref = useRef<T>(null);
  // No-IntersectionObserver-support resolves during the lazy initializer
  // (a pure environment check, no DOM/ref needed) rather than a
  // synchronous `setState` inside the effect below, which
  // `react-hooks/set-state-in-effect` correctly flags — show it rather
  // than hide it forever on an environment that can't ever tell us it's
  // in view.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold: amount },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [amount]);

  return { ref, inView };
}
