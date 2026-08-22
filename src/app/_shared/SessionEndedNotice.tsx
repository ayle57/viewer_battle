"use client";

import { Badge, Card, CardBody } from "@/ui";
import styles from "./SessionEndedNotice.module.css";

/**
 * The one screen every role converges on once Session.status flips to
 * FINISHED (see sessionPhase.ts's SESSION_FINISHED) — deliberately the
 * SAME component for Host, Player, and Display, not three bespoke
 * copies: "the show is over" is one fact, not three. A finished session
 * still resolves `session.getState` (only tokens stop resolving — see
 * resolveParticipantByToken), which is exactly what every product page
 * polls to derive this phase in the first place, so this reliably shows
 * up for everyone within one polling interval, no manual refresh.
 *
 * `sessionCode` is optional — display/page.tsx never passes it. The
 * Display screen is the one that's actually shown to a public stream
 * audience (OBS output), so it must never render the join code on
 * screen: any viewer reading it off the stream could join live. Host
 * and Player are each only ever visible to the one person running that
 * tab, so showing it back to them there is harmless.
 */
export function SessionEndedNotice({ sessionCode }: { sessionCode?: string }) {
  return (
    <div className={styles.wrap}>
      <Card variant="raised">
        <CardBody>
          <div className={styles.body}>
            {sessionCode && <Badge variant="neutral">Session {sessionCode}</Badge>}
            <p className={styles.title}>Session ended</p>
            <p className={styles.subtitle}>The host has ended this show. Thanks for playing!</p>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
