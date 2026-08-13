import { z } from "zod";
import { router, publicProcedure } from "@/server/trpc/trpc";
import { prisma } from "@/server/db/client";

/**
 * Phase 0 spike router: a single procedure that proves the full path
 * (Route Handler -> tRPC -> Prisma -> PostgreSQL -> typed response ->
 * React Query on the client) works end to end. Real routers (auth,
 * session, content, ...) arrive in the next phase.
 */
export const appRouter = router({
  health: router({
    check: publicProcedure.input(z.void()).query(async () => {
      const spikeCheckRows = await prisma.spikeCheck.count();
      return {
        ok: true as const,
        spikeCheckRows,
        timestamp: new Date().toISOString(),
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
