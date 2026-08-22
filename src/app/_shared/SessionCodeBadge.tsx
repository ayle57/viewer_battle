"use client";

import { useState } from "react";
import { Badge, Button } from "@/ui";
import styles from "./SessionCodeBadge.module.css";

export interface SessionCodeBadgeProps {
  code: string;
  /**
   * Host-only — present -> a "New code" button appears next to Copy.
   * Optional and otherwise absent on purpose: this same badge is reused
   * by the dev playground (/dev/host, /dev/session), which has no
   * rotate-code mutation wired up and no reason to grow one; only
   * host/page.tsx's real usage passes this.
   */
  onRegenerate?: () => void;
  regenerating?: boolean;
}

/**
 * The session code, big enough to read at a glance, with a copy button —
 * used by the lobby (/dev/session) and the host's regie header. Small
 * enough (a Badge + a clipboard call) that it doesn't need to live in
 * src/ui as a design-system primitive; it's specific to how this app
 * shows a session code, not a generic pattern other products would reuse
 * as-is.
 */
export function SessionCodeBadge({ code, onRegenerate, regenerating = false }: SessionCodeBadgeProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard permission denied or unavailable — not worth surfacing
      // as an error, the code is right there to select manually.
    }
  }

  return (
    <div className={styles.wrap}>
      <Badge variant={copied ? "success" : "neutral"} size="md" className={copied ? styles.pop : undefined}>
        Session {code}
      </Badge>
      <Button size="sm" variant="ghost" onClick={() => void copy()}>
        {copied ? "✓ Copied" : "Copy"}
      </Button>
      {onRegenerate && (
        <Button size="sm" variant="ghost" disabled={regenerating} loading={regenerating} onClick={onRegenerate} title="Invalidate this code — anyone who only knows the old one can no longer join">
          🔄 New code
        </Button>
      )}
    </div>
  );
}
