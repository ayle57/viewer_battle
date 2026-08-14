import { z } from "zod";

/**
 * CREATED -> ACTIVE -> FINISHED.
 *
 * CREATED: session exists, nobody has joined yet.
 * ACTIVE: at least one participant has joined; still joinable.
 * FINISHED: the host ended it; no longer joinable, tokens for it stop
 * resolving (see resolveParticipantByToken).
 *
 * No CLOSED/EXPIRED yet — nothing in this codebase produces those
 * transitions today, and adding states with no way to reach them is just
 * unused surface area. Add them when there's a real trigger (e.g.
 * abandoned-session cleanup), not preemptively.
 */
export const sessionStatusSchema = z.enum(["CREATED", "ACTIVE", "FINISHED"]);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;
