"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { trpc } from "@/app/_trpc/client";

export type ProbeStatus = "checking" | "ok" | "down";

/**
 * Real reachability checks for the landing page's service-status panel —
 * no hardcoded "all green" placeholder.
 *
 * DB: a real tRPC query that runs `SELECT 1` through Prisma
 * (system.health).
 *
 * Realtime: a real Socket.IO connection attempt against the real server,
 * with auth deliberately omitted. Either "connect" or a "connect_error"
 * (the auth middleware rejecting it — see src/server/auth) proves the
 * server is up and answering; only a network-level failure to ever
 * respond means "down". Closed immediately either way — this is a
 * reachability probe, not a real session.
 */
export function useServiceStatus() {
  const health = trpc.system.health.useQuery(undefined, { retry: false });
  const [socketStatus, setSocketStatus] = useState<ProbeStatus>("checking");

  useEffect(() => {
    const socket = io({
      path: "/socket.io",
      reconnection: false,
      timeout: 4000,
    });

    let settled = false;
    const settle = (status: ProbeStatus) => {
      if (settled) return;
      settled = true;
      setSocketStatus(status);
      socket.close();
    };

    socket.on("connect", () => settle("ok"));
    socket.on("connect_error", () => settle("ok")); // server answered and rejected us — still reachable
    const timer = setTimeout(() => settle("down"), 4500);

    return () => {
      clearTimeout(timer);
      socket.close();
    };
  }, []);

  const dbStatus: ProbeStatus = health.isLoading ? "checking" : health.data?.dbOk ? "ok" : "down";

  return { dbStatus, socketStatus };
}
