"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Badge } from "@/ui";
import { useDevIdentityStore } from "./devIdentityStore";
import { ROLE_LABEL } from "./roleLabels";
import styles from "./DevNav.module.css";

const TOOLS = [
  { href: "/dev", label: "Dashboard" },
  { href: "/dev/components", label: "Components" },
  { href: "/dev/chat", label: "Chat" },
  { href: "/dev/session", label: "Session" },
  { href: "/dev/host", label: "Host" },
  { href: "/dev/player", label: "Player" },
  { href: "/dev/display", label: "Display" },
  { href: "/dev/game", label: "Game" },
];

export function DevNav({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const identity = useDevIdentityStore((state) => state.identity);
  const activeTool = TOOLS.find((tool) => tool.href === pathname)?.label ?? "Tool";
  const environment = process.env.NODE_ENV ?? "development";

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <p className={styles.brandTitle}>ViewerBattle</p>
          <p className={styles.brandSubtitle}>Dev Playground</p>
        </div>
        <nav className={styles.links} aria-label="Dev tools">
          {TOOLS.map((tool) => (
            <Link
              key={tool.href}
              href={tool.href}
              className={[styles.link, pathname === tool.href && styles.linkActive].filter(Boolean).join(" ")}
            >
              {tool.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className={styles.main}>
        <header className={styles.header}>
          <div className={styles.headerTitle}>
            <p className={styles.kicker}>DEV TOOL</p>
            <p className={styles.title}>{activeTool}</p>
          </div>
          <div className={styles.headerBadges}>
            <Badge variant="warning" dot size="sm">
              {environment}
            </Badge>
            <Badge variant="neutral" size="sm">
              {identity ? `${identity.displayName} · ${ROLE_LABEL[identity.role]}` : "No identity selected"}
            </Badge>
            <Badge variant="neutral" size="sm">
              {identity ? `Session ${identity.sessionCode}` : "Session not selected"}
            </Badge>
          </div>
        </header>
        <div className={styles.content}>{children}</div>
      </div>
    </div>
  );
}
