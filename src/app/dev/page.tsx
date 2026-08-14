"use client";

import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, Tabs } from "@/ui";
import { DemoGamePanel } from "./_shared/DemoGamePanel";
import { FullGameTest } from "./_shared/FullGameTest";
import { useServiceStatus, type ProbeStatus } from "./_shared/useServiceStatus";
import styles from "./page.module.css";

type ToolStatus = "done" | "partial" | "skeleton";

const TOOLS: { href: string; title: string; status: ToolStatus; description: string }[] = [
  {
    href: "/dev/components",
    title: "Components",
    status: "done",
    description: "UI Kit showcase — every primitive and ViewerBattle component, real tokens.",
  },
  {
    href: "/dev/chat",
    title: "Chat",
    status: "done",
    description: "Real-time chat vertical slice: auth, rooms, permissions, persistence, history.",
  },
  {
    href: "/dev/session",
    title: "Manual Session",
    status: "done",
    description: "Create/join a real session by hand, pick a role yourself — for testing edge cases Quick Demo skips.",
  },
  {
    href: "/dev/host",
    title: "Host",
    status: "done",
    description: "Real host control panel — board, judge/close, scores, connection status.",
  },
  {
    href: "/dev/player",
    title: "Player",
    status: "done",
    description: "Real player view — buzz, board, live result, never sees an answer.",
  },
  {
    href: "/dev/display",
    title: "Display",
    status: "done",
    description: "Read-only OBS-style overlay — board, scores, active question, no actions.",
  },
  {
    href: "/dev/game",
    title: "Game",
    status: "done",
    description: "Pure Game Kernel lab — runs the engine directly in the browser, no session needed.",
  },
];

const STATUS_BADGE: Record<ToolStatus, { variant: "success" | "warning" | "neutral"; label: string }> = {
  done: { variant: "success", label: "functional" },
  partial: { variant: "warning", label: "partial" },
  skeleton: { variant: "neutral", label: "skeleton" },
};

const PROBE_BADGE: Record<ProbeStatus, { variant: "success" | "warning" | "danger"; label: string }> = {
  checking: { variant: "warning", label: "checking…" },
  ok: { variant: "success", label: "reachable" },
  down: { variant: "danger", label: "unreachable" },
};

export default function DevDashboardPage() {
  const { dbStatus, socketStatus } = useServiceStatus();

  return (
    <main className={styles.page}>
      <div className={styles.intro}>
        <h1>ViewerBattle — Dev Game Room</h1>
        <p>
          Click Create Demo Game, open Host/Team A/Team B/Display, and watch a real ViewerBattle game synchronize —
          real Prisma session, real Socket.IO, real Game Kernel. No tokens to copy, no forms to fill in.
        </p>
      </div>

      <Tabs
        items={[
          { value: "quick", label: "Quick Demo", content: <DemoGamePanel /> },
          { value: "test", label: "Run Full Game Test", content: <FullGameTest /> },
          {
            value: "manual",
            label: "Manual Session",
            content: (
              <Card>
                <CardHeader title="Manual Session" subtitle="For testing edge cases Quick Demo doesn't cover" />
                <CardBody>
                  <p className={styles.toolDescription}>
                    Pick your own session code, role, and display name — the same tool Quick Demo uses under the
                    hood, just one identity at a time instead of six at once. Use this for testing things like a
                    full team (TEAM_FULL), a session that&apos;s already finished, or joining mid-game.
                  </p>
                  <Link href="/dev/session" className={styles.manualLink}>
                    Open /dev/session →
                  </Link>
                </CardBody>
              </Card>
            ),
          },
        ]}
      />

      <section>
        <h2>Services</h2>
        <div className={styles.statusRow}>
          <Badge variant={PROBE_BADGE[dbStatus].variant} dot>
            Database — {PROBE_BADGE[dbStatus].label}
          </Badge>
          <Badge variant={PROBE_BADGE[socketStatus].variant} dot>
            Socket.IO — {PROBE_BADGE[socketStatus].label}
          </Badge>
        </div>
      </section>

      <section>
        <h2>All tools</h2>
        <div className={styles.toolGrid}>
          {TOOLS.map((tool) => (
            <Link key={tool.href} href={tool.href} className={styles.toolCard}>
              <Card>
                <CardHeader
                  title={
                    <div className={styles.toolCardHeader}>
                      <span>{tool.title}</span>
                      <Badge variant={STATUS_BADGE[tool.status].variant}>{STATUS_BADGE[tool.status].label}</Badge>
                    </div>
                  }
                />
                <CardBody>
                  <p className={styles.toolDescription}>{tool.description}</p>
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
