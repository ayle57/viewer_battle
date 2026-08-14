import styles from "./QuestionPrompt.module.css";

export interface QuestionPromptProps {
  category?: string;
  points?: number;
  /** Empty string renders `emptyLabel` instead — matches how a redacted/not-yet-revealed prompt arrives from the server (never `null`, see the Game Kernel's "plain JSON" state rule). */
  prompt: string;
  /** Only pass this if the caller is actually allowed to show it (e.g. the host) — this component doesn't know or enforce who's allowed to see it, it just renders what it's given. */
  answer?: string;
  emptyLabel?: string;
  /** "md" (default) fits Host/Player. "lg" is the OBS-scale hero treatment Display needs — same layout, much bigger type. */
  size?: "md" | "lg";
}

/**
 * "The prompt currently in play, with a header for its category/value and
 * an optional answer reveal" — generic enough for any trivia-shaped
 * moment (Mini Jeopardy today; Guess the Music/Steam Ratings later likely
 * want the same shape), not board-question-specific. The board grid
 * itself stays with Mini Jeopardy's own view code since a category x
 * point-value grid isn't a shape other games share.
 */
export function QuestionPrompt({ category, points, prompt, answer, emptyLabel = "No active question.", size = "md" }: QuestionPromptProps) {
  return (
    <div className={[styles.card, size === "lg" && styles.lg].filter(Boolean).join(" ")}>
      {(category || points !== undefined) && (
        <p className={styles.kicker}>
          {category}
          {category && points !== undefined ? " · " : ""}
          {points !== undefined && <span className={styles.points}>{points} pts</span>}
        </p>
      )}
      <p className={[styles.prompt, !prompt && styles.promptEmpty].filter(Boolean).join(" ")}>
        {prompt || emptyLabel}
      </p>
      {answer && (
        <p className={styles.answer}>
          <span className={styles.answerLabel}>Answer</span>
          {answer}
        </p>
      )}
    </div>
  );
}
