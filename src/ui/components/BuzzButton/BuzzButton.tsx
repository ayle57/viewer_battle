import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./BuzzButton.module.css";

export type BuzzButtonVariant = "neutral" | "teamA" | "teamB";

export interface BuzzButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: BuzzButtonVariant;
  /** Waiting on the server's ack for a buzz already sent — distinct from `disabled` (not your turn), shows a spinner instead of dimming. */
  pending?: boolean;
  children?: ReactNode;
}

/**
 * The oversized, hard-to-miss action for a buzzer moment — deliberately
 * not just a large `Button`: gently pulses while enabled to draw the eye
 * (any buzzer-style game wants this, not just Mini Jeopardy), team-
 * colored via `variant` using the same team tokens Badge/ScoreDisplay do.
 */
export function BuzzButton({ variant = "neutral", pending = false, disabled, className, children, ...rest }: BuzzButtonProps) {
  const classes = [styles.button, variant !== "neutral" && styles[variant], className].filter(Boolean).join(" ");

  return (
    <button className={classes} disabled={disabled || pending} aria-busy={pending || undefined} {...rest}>
      {pending ? <span className={styles.spinner} aria-hidden="true" /> : (children ?? "Buzz")}
    </button>
  );
}
