"use client";

import { Badge, Button, Card, CardBody } from "@/ui";
import styles from "./KickedNotice.module.css";

/**
 * The screen a Player/Display lands on the instant the Host removes them
 * (session.kick -> broadcastParticipantKicked -> gameStore.ts's
 * `kicked`) — a sibling of SessionEndedNotice, deliberately NOT the same
 * component: ending a session is a terminal dead end for everyone, being
 * kicked is scoped to just this one participant — the session is still
 * very much alive for everyone else.
 *
 * NOT a "your seat is free, rejoin instantly" screen — `session.kick`
 * (router.ts) rotates the session's own join code in the same breath
 * (rotateSessionCode, src/server/db/session.ts), specifically so the
 * code THIS tab still knows stops working the instant it's kicked. A
 * real way back in exists, it just isn't self-service: the Host has to
 * hand out the new code. `sessionCode` is never passed here anymore for
 * exactly that reason (see display/page.tsx's identical reasoning on
 * SessionEndedNotice) — showing the OLD, now-dead code back to a kicked
 * participant would be actively misleading, not just useless.
 */
export function KickedNotice({ onRejoin }: { onRejoin: () => void }) {
  return (
    <div className={styles.wrap}>
      <Card variant="raised">
        <CardBody>
          <div className={styles.body}>
            <Badge variant="danger">Removed</Badge>
            <p className={styles.title}>You were removed</p>
            <p className={styles.subtitle}>The host disconnected you from this session. Ask them for the new session code to rejoin.</p>
            <Button size="lg" onClick={onRejoin}>
              Back to join screen
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
