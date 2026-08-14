import type { HTMLAttributes, ReactNode } from "react";
import styles from "./Badge.module.css";

export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "teamA" | "teamB" | "host" | "display";
export type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  dot?: boolean;
  children: ReactNode;
}

export function Badge({ variant = "neutral", size = "md", dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[variant], styles[size], className].filter(Boolean).join(" ")} {...rest}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  );
}
