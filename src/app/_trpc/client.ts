import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "@/server/trpc/router";

// Only the *type* of the router crosses into client code — no server
// modules are pulled into the browser bundle.
export const trpc = createTRPCReact<AppRouter>();
