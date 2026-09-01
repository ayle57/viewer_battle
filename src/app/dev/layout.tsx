import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { DevNav } from "./_shared/DevNav";

/**
 * `/dev/*` is the internal development playground (see AGENTS.md) — never
 * part of the product. It's 404'd entirely in production so a client
 * deployment doesn't ship the extra routes/attack surface. The
 * `DEV_PLAYGROUND_HOST_PASSWORD` shortcut (src/server/auth/hostPassword.ts)
 * is already `NODE_ENV`-gated on the server; this closes the pages too.
 */
export default function DevLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return <DevNav>{children}</DevNav>;
}
