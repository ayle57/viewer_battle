// Excludes visually ambiguous characters (0/O, 1/I/L) — this code is meant
// to be read off a screen and typed by a human joining a session.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const LENGTH = 6;

/**
 * Generates a human-typeable session code. Takes its randomness source as
 * a parameter (defaults to Math.random) purely so it's deterministically
 * testable — this is otherwise a pure string computation, no I/O.
 */
export function generateSessionCode(random: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < LENGTH; i++) {
    code += ALPHABET[Math.floor(random() * ALPHABET.length)];
  }
  return code;
}
