"use client";

import { useState, type FormEvent } from "react";
import { Button } from "../../primitives/Button/Button";
import { Input } from "../../primitives/Input/Input";
import styles from "./AnswerInput.module.css";

export interface AnswerInputProps {
  /** Real game:action dispatch, wired by whoever uses this (see PlayerBoardPanel) — this component owns no transport logic, same as ChatPanel/BuzzButton. */
  onSubmit: (text: string) => void;
  /** Waiting on the server's ack for an answer already sent. */
  pending?: boolean;
  /** This buzz's answer was already sent (by this client or echoed back from the server) — shows a confirmation instead of the field. */
  submitted?: boolean;
  placeholder?: string;
  submitLabel?: string;
}

/**
 * The "you buzzed, now answer" moment: a text field + send button, Enter
 * submits (form onSubmit, same pattern as ChatPanel's composer), disabled
 * while pending, replaced by a confirmation once `submitted`. Generic
 * enough for any buzzer-style game that wants a typed answer, not
 * BoardQuestion-specific — that's why it lives here and not in
 * app/dev/_shared/boardQuestion.
 */
export function AnswerInput({
  onSubmit,
  pending = false,
  submitted = false,
  placeholder = "Type your answer...",
  submitLabel = "Send answer",
}: AnswerInputProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || pending || submitted) return;
    onSubmit(text);
  }

  if (submitted) {
    return (
      <div className={styles.confirmation} role="status">
        <span className={styles.checkmark} aria-hidden="true">
          ✓
        </span>
        Answer sent — waiting on the host.
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div className={styles.inputWrap}>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          disabled={pending}
          aria-label="Your answer"
          autoFocus
        />
      </div>
      <Button type="submit" loading={pending} disabled={draft.trim().length === 0}>
        {submitLabel}
      </Button>
    </form>
  );
}
