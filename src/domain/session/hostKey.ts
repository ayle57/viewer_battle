// Same "no visually ambiguous characters" reasoning as sessionCode.ts —
// this one gets written down / screenshotted by a human, not just typed
// once while joining, so ambiguity matters even more here.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const GROUP_LENGTH = 4;
const GROUPS = 3;

/**
 * Generates a human-writable host recovery key — shown to the host
 * exactly once at session.create, never derivable again. Its only job is
 * letting `reclaimHost` (src/server/db/participant.ts) rotate the host's
 * Participant.tokenHash if the original bearer token is lost (browser
 * closed, sessionStorage cleared — see identityStore.ts). Deliberately a
 * SEPARATE secret from the token, not a replacement for it: the token
 * stays the fast, silent, per-tab reconnect path; this is the slow,
 * explicit, "I actually lost it" recovery path.
 *
 * `ALPHABET.length ** (GROUP_LENGTH * GROUPS)` = 32**12 ≈ 2^60 possible
 * keys — plenty for a secret that's only ever checked against one
 * specific session and isn't the kind of thing worth brute-forcing
 * (there's still a real session code gating which session it even
 * applies to).
 */
export function generateHostKey(random: () => number = Math.random): string {
  const groups: string[] = [];
  for (let g = 0; g < GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GROUP_LENGTH; i++) {
      group += ALPHABET[Math.floor(random() * ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}
