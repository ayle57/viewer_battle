"use client";

import Link from "next/link";
import { Badge, Card, CardBody, CardHeader } from "@/ui";
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
    title: "Session",
    status: "done",
    description: "Create or join a real Session, pick a test identity for the rest of the playground.",
  },
  {
    href: "/dev/host",
    title: "Host",
    status: "skeleton",
    description: "Host control panel — teams, players, game state, score, timer, actions, events.",
  },
  {
    href: "/dev/player",
    title: "Player",
    status: "skeleton",
    description: "Player view — presence, game state, available actions, score, reconnection.",
  },
  {
    href: "/dev/display",
    title: "Display",
    status: "skeleton",
    description: "OBS overlay simulation — public session state, same permissions as the real display.",
  },
  {
    href: "/dev/game",
    title: "Game",
    status: "skeleton",
    description: "Game Kernel cockpit — engine state, actions, transitions, events, reset, replay.",
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
        <h1>ViewerBattle — Dev Playground</h1>
        <p>
          A permanent development lab, not a set of mockups: every tool here runs the real UI Kit, the real
          Socket.IO server, the real tRPC routers, and the real database. Panels that don&apos;t have a backend yet
          say so — nothing here fakes a feature that doesn&apos;t exist. Run one browser tab per role (Host, Team A,
          Team B, Display) to watch a session synchronize for real, without building the final product first.
        </p>
      </div>

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
        <h2>Tools</h2>
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
