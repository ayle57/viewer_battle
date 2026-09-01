"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "../../primitives/Button/Button";
import { Input } from "../../primitives/Input/Input";
import { ChatMessage, type ChatMessageData } from "../ChatMessage/ChatMessage";
import styles from "./ChatPanel.module.css";

export interface ChatPanelProps {
  messages: ChatMessageData[];
  /**
   * Send handler. May return (or resolve to) `{ ok: false, error }` — the
   * composer then keeps the text and shows `error` under the field
   * instead of clearing, so a rejected message (word filter, a transient
   * failure) isn't silently swallowed. Anything else counts as sent.
   */
  onSend?: (body: string) => void | { ok: boolean; error?: string } | Promise<void | { ok: boolean; error?: string }>;
  /** Read-only mode (e.g. the Display role can watch but not post). */
  disabled?: boolean;
  /**
   * Drop the composer row entirely rather than showing it greyed-out.
   * For the Display/OBS overlay: it's read-only AND on stream, so a dead
   * input + Send button is pure clutter in the capture. A `disabled`
   * player (e.g. on the PUBLIC/announcements tab) still keeps the greyed
   * composer — the "Read-only" affordance is useful there, it's not on air.
   */
  hideComposer?: boolean;
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
  hideComposer = false,
  title,
  placeholder = "Message...",
  sendLabel = "Send",
  emptyLabel = "No messages yet.",
}: ChatPanelProps) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const messagesRef = useRef<HTMLDivElement>(null);

  // New messages arrive at the bottom of a scrollable list — without this
  // they'd land out of view unless the reader happened to already be
  // scrolled all the way down, which is the opposite of what a chat is for.
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || disabled || sending) return;
    setSendError(null);
    const result = onSend?.(body);
    if (result && typeof (result as Promise<unknown>).then === "function") {
      setSending(true);
      void (result as Promise<void | { ok: boolean; error?: string }>)
        .then((r) => {
          if (r && r.ok === false) setSendError(r.error ?? "Message not sent.");
          else setDraft("");
        })
        .catch(() => setSendError("Message not sent — try again."))
        .finally(() => setSending(false));
      return;
    }
    if (result && (result as { ok: boolean }).ok === false) {
      setSendError((result as { error?: string }).error ?? "Message not sent.");
      return;
    }
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
      {/* `role="log"` — the standard ARIA pattern for a stream of
          sequentially-added messages (implies `aria-live="polite"` on
          its own; set explicitly too for broader AT support) — a real,
          audited gap: nothing here ever told a screen reader a new
          message had arrived, on a screen where chat is genuinely live
          during a show. */}
      <div className={styles.messages} ref={messagesRef} role="log" aria-live="polite" aria-label={title ?? "Chat messages"}>
        {messages.length === 0 && <p className={styles.empty}>{emptyLabel}</p>}
        {messages.map((message) => (
          <ChatMessage key={message.id} {...message} />
        ))}
      </div>
      {!hideComposer && (
        <form className={styles.composer} onSubmit={handleSubmit}>
          <div className={styles.composerInput}>
            <Input
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (sendError) setSendError(null);
              }}
              placeholder={disabled ? "Read-only" : placeholder}
              disabled={disabled}
              aria-label="Message"
              error={sendError ?? undefined}
            />
          </div>
          <Button type="submit" loading={sending} disabled={disabled || draft.trim().length === 0}>
            {sendLabel}
          </Button>
        </form>
      )}
    </div>
  );
}
