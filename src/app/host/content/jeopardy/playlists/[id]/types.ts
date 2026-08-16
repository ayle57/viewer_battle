import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/router";

type RouterOutputs = inferRouterOutputs<AppRouter>;

/** The exact shape `content.playlist.get` resolves to on the client — inferred from the router itself so this file can never drift from the real API. */
export type PlaylistDetailClient = RouterOutputs["content"]["playlist"]["get"];
export type PlaylistCategoryClient = PlaylistDetailClient["categories"][number];
export type PlaylistQuestionClient = PlaylistCategoryClient["questions"][number];
