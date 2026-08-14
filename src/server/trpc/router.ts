import { router } from "@/server/trpc/trpc";

/**
 * Real routers (auth, session, content, ...) get merged in here as they
 * land. tRPC is request/response only — see src/server/trpc/trpc.ts.
 * All realtime traffic (including chat) goes through Socket.IO, not tRPC.
 */
export const appRouter = router({});

export type AppRouter = typeof appRouter;
