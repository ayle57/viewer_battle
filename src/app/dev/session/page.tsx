"use client";

import { useState } from "react";
import Link from "next/link";
import type { ParticipantRole } from "@/domain/session";
import { Badge, Button, Card, CardBody, CardHeader, Input } from "@/ui";
import { trpc } from "@/app/_trpc/client";
import { useDevIdentityStore } from "../_shared/devIdentityStore";
import { ROLE_LABEL } from "../_shared/roleLabels";
import styles from "./page.module.css";

export default function SessionPage() {
  const identity = useDevIdentityStore((state) => state.identity);
  const setIdentity = useDevIdentityStore((state) => state.setIdentity);
  const clearIdentity = useDevIdentityStore((state) => state.clearIdentity);

  const [sessionCode, setSessionCode] = useState(identity?.sessionCode ?? "");
  const [role, setRole] = useState<ParticipantRole>(identity?.role ?? "HOST");
  const [displayName, setDisplayName] = useState(identity?.displayName ?? "");

  const create = trpc.session.create.useMutation({
    onSuccess: (session) => setSessionCode(session.code),
  });
  const join = trpc.session.join.useMutation({
    onSuccess: (result) => {
      setIdentity({
        sessionCode: result.sessionCode,
        role: result.role,
        displayName: result.displayName,
        token: result.token,
      });
    },
  });
  const finish = trpc.session.finish.useMutation();

  const state = trpc.session.getState.useQuery(
    { sessionCode },
    { enabled: sessionCode.trim().length > 0, refetchInterval: 2000, retry: false },
  );

  function handleJoin(event: React.FormEvent) {
    event.preventDefault();
    const code = sessionCode.trim();
    const name = displayName.trim();
    if (!code || !name) return;
    join.mutate({ sessionCode: code, role, displayName: name, token: identity?.token });
  }

  const joinErrorCode = join.error?.data?.sessionErrorCode;
  const stateErrorCode = state.error?.data?.sessionErrorCode;

  return (
    <main className={styles.page}>
      <h1>Session</h1>
      <p className={styles.hint}>
        Real session lifecycle — <code>session.create</code>/<code>session.join</code>/<code>session.getState</code>{" "}
        via tRPC → Prisma → Postgres, with real capacity limits enforced server-side (1 Host, 2 players per team, DB
        constraints under the hood — see AGENTS.md &quot;Session invariants&quot;). The identity you get here is a
        real bearer token, reused by /dev/chat, /dev/host, /dev/player, /dev/display as they get wired up.
      </p>

      {identity && (
        <Card>
          <CardHeader title="Current identity (this tab)" />
          <CardBody>
            <div className={styles.currentRow}>
              <Badge variant="neutral">{identity.displayName}</Badge>
              <Badge variant="neutral">{ROLE_LABEL[identity.role]}</Badge>
              <Badge variant="neutral">{identity.sessionCode}</Badge>
              <Button size="sm" variant="ghost" onClick={clearIdentity}>
                Clear
              </Button>
              {identity.role === "HOST" && (
                <Button
                  size="sm"
                  variant="danger"
                  loading={finish.isPending}
                  onClick={() => finish.mutate({ token: identity.token })}
                >
                  Finish session
                </Button>
              )}
            </div>
            {finish.isSuccess && <p className={styles.hint}>Session finished — it can no longer be joined.</p>}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader title="Create a session" />
        <CardBody>
          <Button onClick={() => create.mutate()} loading={create.isPending}>
            Create new session
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title={identity ? "Switch identity" : "Join a session"} />
        <CardBody>
          <form className={styles.form} onSubmit={handleJoin}>
            <Input
              label="Session code"
              value={sessionCode}
              onChange={(event) => setSessionCode(event.target.value)}
              placeholder="e.g. X7K2QP"
            />
            <div className={styles.selectField}>
              <label className={styles.selectLabel} htmlFor="role">
                Role
              </label>
              <select
                id="role"
                className={styles.select}
                value={role}
                onChange={(event) => setRole(event.target.value as ParticipantRole)}
              >
                {(Object.keys(ROLE_LABEL) as ParticipantRole[]).map((value) => (
                  <option key={value} value={value}>
                    {ROLE_LABEL[value]}
                  </option>
                ))}
              </select>
            </div>
            <Input
              label="Display name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="e.g. Jamie"
            />
            {join.error && (
              <p className={styles.errorBanner}>
                {joinErrorCode ? `${joinErrorCode} — ` : ""}
                {join.error.message}
              </p>
            )}
            <Button type="submit" loading={join.isPending} disabled={!sessionCode.trim() || !displayName.trim()}>
              {identity ? "Update identity" : "Join session"}
            </Button>
          </form>
        </CardBody>
      </Card>

      {sessionCode.trim() && (
        <Card>
          <CardHeader title={`Session state — ${sessionCode.trim()}`} subtitle="Polling every 2s" />
          <CardBody>
            {stateErrorCode && <p className={styles.errorBanner}>{stateErrorCode} — {state.error?.message}</p>}
            {state.data && (
              <div className={styles.stateGrid}>
                <div>
                  <p className={styles.selectLabel}>Status: {state.data.status}</p>
                  <div className={styles.slot}>
                    <span>Host</span>
                    {state.data.host ? (
                      <Badge variant="host">{state.data.host.displayName}</Badge>
                    ) : (
                      <span className={styles.slotEmpty}>empty</span>
                    )}
                  </div>
                </div>
                <div>
                  <p className={styles.selectLabel}>
                    Team A ({state.data.teamA.length}/2, {state.data.capacity.teamASlotsRemaining} left)
                  </p>
                  {[0, 1].map((i) => (
                    <div key={i} className={styles.slot}>
                      <span>Seat {i + 1}</span>
                      {state.data.teamA[i] ? (
                        <Badge variant="teamA">{state.data.teamA[i]?.displayName}</Badge>
                      ) : (
                        <span className={styles.slotEmpty}>empty</span>
                      )}
                    </div>
                  ))}
                </div>
                <div>
                  <p className={styles.selectLabel}>
                    Team B ({state.data.teamB.length}/2, {state.data.capacity.teamBSlotsRemaining} left)
                  </p>
                  {[0, 1].map((i) => (
                    <div key={i} className={styles.slot}>
                      <span>Seat {i + 1}</span>
                      {state.data.teamB[i] ? (
                        <Badge variant="teamB">{state.data.teamB[i]?.displayName}</Badge>
                      ) : (
                        <span className={styles.slotEmpty}>empty</span>
                      )}
                    </div>
                  ))}
                </div>
                <div>
                  <p className={styles.selectLabel}>Display connections</p>
                  <div className={styles.slot}>
                    <span>Connected</span>
                    <Badge variant="display">{state.data.displayCount}</Badge>
                  </div>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {identity && (
        <Card>
          <CardHeader title="Jump to a tool" subtitle="Using this tab's current identity" />
          <CardBody>
            <div className={styles.jumpGrid}>
              <Link href="/dev/chat">
                <Button variant="secondary" size="sm">
                  Chat
                </Button>
              </Link>
              <Link href="/dev/host">
                <Button variant="secondary" size="sm">
                  Host
                </Button>
              </Link>
              <Link href="/dev/player">
                <Button variant="secondary" size="sm">
                  Player
                </Button>
              </Link>
              <Link href="/dev/display">
                <Button variant="secondary" size="sm">
                  Display
                </Button>
              </Link>
            </div>
          </CardBody>
        </Card>
      )}
    </main>
  );
}
