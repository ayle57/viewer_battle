"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { trpc } from "@/app/_trpc/client";

const ROOM = "spike-room";

export default function SpikePage() {
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected" | "unauthorized">("connecting");
  const [log, setLog] = useState<string[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const health = trpc.health.check.useQuery();

  useEffect(() => {
    const socket = io({
      path: "/socket.io",
      auth: { token: process.env.NEXT_PUBLIC_SPIKE_TOKEN },
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      setStatus("connected");
      socket.emit("spike:join-room", ROOM);
    });
    socket.on("disconnect", () => setStatus("disconnected"));
    socket.on("connect_error", (err) => {
      setStatus("unauthorized");
      setLog((l) => [...l, `connect_error: ${err.message}`]);
    });
    socket.on("spike:pong", (payload: { message: string; from: string }) => {
      setLog((l) => [...l, `pong from ${payload.from}: ${payload.message}`]);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>Phase 0 spike</h1>

      <section>
        <h2>Socket.IO</h2>
        <p>Status: {status}</p>
        <button
          onClick={() =>
            socketRef.current?.emit("spike:ping", {
              room: ROOM,
              message: `hello at ${new Date().toISOString()}`,
            })
          }
        >
          Send ping to room
        </button>
        <ul>
          {log.map((entry, i) => (
            <li key={i}>{entry}</li>
          ))}
        </ul>
      </section>

      <section>
        <h2>tRPC</h2>
        {health.isLoading && <p>loading...</p>}
        {health.error && <p>error: {health.error.message}</p>}
        {health.data && <pre>{JSON.stringify(health.data, null, 2)}</pre>}
      </section>
    </main>
  );
}
