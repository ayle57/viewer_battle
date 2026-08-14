import Link from "next/link";
import styles from "./page.module.css";

/**
 * The real product entry point — a static landing page, nothing else.
 * No tRPC, no Socket.IO, no identity, no session: someone can land here
 * with the backend down and still understand what ViewerBattle is and
 * where to click. /host, /player, /display each own their own real
 * connexion flow (session.create/session.join) — this page only links
 * to them.
 *
 * The CTAs are `<Link>`s styled to match the UI Kit's Button primitive
 * (same tokens, same hover/focus-visible treatment) rather than a
 * `<Button>` wrapped in a `<Link>` — Button renders a native `<button>`,
 * and a button nested inside an anchor is invalid HTML (interactive
 * content inside interactive content) even though browsers tolerate it;
 * these needed to be real, crawlable links, not a styling convenience.
 */
export default function HomePage() {
  return (
    <main className={styles.page}>
      <div className={styles.hero}>
        <p className={styles.wordmark}>VIEWERBATTLE</p>

        <h1 className={styles.headline}>Your viewers. Two teams. One battle.</h1>
        <p className={styles.subtitle}>
          A live 2v2 gameshow for your stream — host a round, get your community buzzing in, and watch the score
          update in real time.
        </p>

        <div className={styles.ctaRow}>
          <Link href="/host" className={[styles.cta, styles.ctaPrimary].join(" ")}>
            Host a Game
          </Link>
          <Link href="/player" className={[styles.cta, styles.ctaSecondary].join(" ")}>
            Join a Game
          </Link>
        </div>

        <Link href="/display" className={styles.watchLink}>
          Watch on a Display →
        </Link>
      </div>

      <Link href="/dev" className={styles.devLink}>
        Developer Playground
      </Link>
    </main>
  );
}
