"use client";

import { useState, type FormEvent } from "react";
import { Button, Input } from "@/ui";
import styles from "./PriceGuessInput.module.css";

export interface PriceGuessInputProps {
  /** Real game:action dispatch, wired by whoever uses this (see PlayerPricePanel) — this component owns no transport logic, same as `AnswerInput`. */
  onSubmit: (guess: number) => void;
  /** Waiting on the server's ack for a guess already sent. */
  pending?: boolean;
  /** This buzz's guess was already sent (by this client or echoed back from the server) — shows a confirmation instead of the field. */
  submitted?: boolean;
  submitLabel?: string;
}

/**
 * The numeric counterpart to `@/ui`'s `AnswerInput` — same "you buzzed,
 * now answer" shape (a field + send button, Enter submits, disabled
 * while pending, replaced by a confirmation once `submitted`), but for a
 * PRICE guess: a float, not free text — "ça peut être un float." Kept
 * local to this game rather than added as a mode on the shared
 * `AnswerInput` (that component is plain-text-only, used by BoardQuestion
 * and Music too — adding numeric parsing there would touch two other
 * games' own tested behavior for a shape only this engine needs).
 *
 * Accepts a comma OR a dot as the decimal separator ("49,99" and
 * "49.99" both parse to the same float) — a plain `<input type="number">`
 * only accepts a dot in most locales, and a French Host's own audience
 * typing on a French keyboard would otherwise get silently rejected.
 * `onSubmit` only ever fires with a real finite, non-negative number —
 * this component is where "is this even a parseable price" gets
 * decided, so the engine's own `submitAnswerActionSchema` never has to
 * reject a malformed value it didn't cause.
 */
export function PriceGuessInput({ onSubmit, pending = false, submitted = false, submitLabel = "Send guess" }: PriceGuessInputProps) {
  const [draft, setDraft] = useState("");

  const parsed = parsePrice(draft);
  const isValid = parsed !== null;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (parsed === null || pending || submitted) return;
    onSubmit(parsed);
  }

  if (submitted) {
    return (
      <div className={styles.confirmation} role="status">
        <span className={styles.checkmark} aria-hidden="true">
          ✓
        </span>
        Guess sent — waiting on the host.
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.inputWrap}>
        <span className={styles.currencyPrefix} aria-hidden="true">
          €
        </span>
        <Input
          size="lg"
          className={styles.input}
          type="text"
          inputMode="decimal"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="49.99"
          disabled={pending}
          aria-label="Your price guess"
          autoFocus
        />
      </div>
      <Button type="submit" size="lg" className={styles.sendButton} loading={pending} disabled={!isValid}>
        {submitLabel}
      </Button>
    </form>
  );
}

/** `null` for anything that isn't a real, finite, non-negative price — an empty field, stray letters, a negative number. Comma normalized to a dot before `Number(...)` (see this file's own doc comment). */
function parsePrice(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!normalized) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}
