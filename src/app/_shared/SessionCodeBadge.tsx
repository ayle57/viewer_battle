"use client";

import { useState } from "react";
import { Badge, Button } from "@/ui";
import styles from "./SessionCodeBadge.module.css";

/**
 * The session code, big enough to read at a glance, with a copy button —
 * used by the lobby (/dev/session) and the host's regie header. Small
 * enough (a Badge + a clipboard call) that it doesn't need to live in
 * src/ui as a design-system primitive; it's specific to how this app
 * shows a session code, not a generic pattern other products would reuse
 * as-is.
 */
export function SessionCodeBadge({ code }: { code: string }) {
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
      <Badge variant="neutral" size="md">
        Session {code}
      </Badge>
      <Button size="sm" variant="ghost" onClick={() => void copy()}>
        {copied ? "Copied!" : "Copy"}
      </Button>
    </div>
  );
}
