"use client";

import { useState, type FormEvent } from "react";
import { Button } from "../../primitives/Button/Button";
import { Input } from "../../primitives/Input/Input";
import { ChatMessage, type ChatMessageData } from "../ChatMessage/ChatMessage";
import styles from "./ChatPanel.module.css";

export interface ChatPanelProps {
  messages: ChatMessageData[];
  onSend?: (body: string) => void;
  /** Read-only mode (e.g. the Display role can watch but not post). */
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  sendLabel?: string;
  emptyLabel?: string;
}

/**
 * Purely presentational chat surface: renders a message list + composer
 * and calls `onSend`. Owns no socket/transport logic — that's wired up by
 * whoever uses it (see /dev/chat).
 */
export function ChatPanel({
  messages,
  onSend,
  disabled = false,
  title,
  placeholder = "Message...",
  sendLabel = "Send",
  emptyLabel = "No messages yet.",
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || disabled) return;
    onSend?.(body);
    setDraft("");
  }

  return (
    <div className={styles.panel}>
      {(title || disabled) && (
        <div className={styles.header}>
          {title ? <p className={styles.title}>{title}</p> : <span />}
          {disabled && <p className={styles.readOnly}>Read-only</p>}
        </div>
      )}
      <div className={styles.messages}>
        {messages.length === 0 && <p className={styles.empty}>{emptyLabel}</p>}
        {messages.map((message) => (
          <ChatMessage key={message.id} {...message} />
        ))}
      </div>
      <form className={styles.composer} onSubmit={handleSubmit}>
        <div className={styles.composerInput}>
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={disabled ? "Read-only" : placeholder}
            disabled={disabled}
            aria-label="Message"
          />
        </div>
        <Button type="submit" disabled={disabled || draft.trim().length === 0}>
          {sendLabel}
        </Button>
      </form>
    </div>
  );
}
