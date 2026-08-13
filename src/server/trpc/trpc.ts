import { initTRPC } from "@trpc/server";

/**
 * tRPC is used for request/response CRUD and admin operations only
 * (content management, session/team/player setup, auth, stats).
 * All realtime traffic goes through Socket.IO — see src/server/sockets.
 */
const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;
