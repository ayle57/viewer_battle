"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import type { ParticipantRole } from "@/domain/session";
import { Button, Card, CardBody, CardHeader } from "@/ui";
import { useDevIdentityStore, type DevIdentity } from "./devIdentityStore";
import { ROLE_LABEL } from "./roleLabels";

export interface RequireIdentityProps {
  /** Roles this tool makes sense for — e.g. Host only, or either team. */
  allow: ParticipantRole[];
  children: (identity: DevIdentity) => ReactNode;
}

/**
 * Gates a dev playground tool on having a test identity with the right
 * role, instead of silently rendering as if you were that role. Shared by
 * /dev/host, /dev/player, /dev/display.
 */
export function RequireIdentity({ allow, children }: RequireIdentityProps) {
  const identity = useDevIdentityStore((state) => state.identity);

  if (!identity) {
    return (
      <Card>
        <CardHeader title="No test identity for this tab" />
        <CardBody>
          <p>Pick a session code, role, and display name in /dev/session first.</p>
          <Link href="/dev/session">
            <Button size="sm">Go to /dev/session</Button>
          </Link>
        </CardBody>
      </Card>
    );
  }

  if (!allow.includes(identity.role)) {
    return (
      <Card>
        <CardHeader title="Wrong role for this tool" />
        <CardBody>
          <p>
            This tab is connected as <strong>{ROLE_LABEL[identity.role]}</strong>. This tool needs:{" "}
            {allow.map((role) => ROLE_LABEL[role]).join(" or ")}.
          </p>
          <Link href="/dev/session">
            <Button size="sm">Switch identity</Button>
          </Link>
        </CardBody>
      </Card>
    );
  }

  return <>{children(identity)}</>;
}
