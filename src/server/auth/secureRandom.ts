import { randomInt } from "node:crypto";

/**
 * A CSPRNG-backed `() => number` in [0, 1), drop-in for the `Math.random`
 * default that `generateSessionCode` / `generateHostKey`
 * (src/domain/session) take as a parameter for testability.
 *
 * Those two secrets gate joining and recovering a live show. `Math.random`
 * (V8's xorshift128+) is fully predictable from a short run of outputs —
 * and session codes ARE observable output, so leaving both on the same
 * PRNG means observing a few codes lets an attacker predict future codes
 * AND host recovery keys (→ take over as HOST). Passing this from the
 * server call site keeps `src/domain` free of a `node:crypto` import (it's
 * re-exported through a barrel that client code also pulls from).
 *
 * `randomInt(2**32)` is rejection-sampled and uniform; dividing by 2**32
 * gives a uniform double in [0, 1) with 32 bits of entropy — ample for
 * picking from a 30-character alphabet.
 */
export function secureUnitRandom(): number {
  return randomInt(0, 2 ** 32) / 2 ** 32;
}
