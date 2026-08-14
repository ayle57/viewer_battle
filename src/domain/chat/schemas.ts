import { z } from "zod";
import { displayNameSchema, participantRoleSchema } from "@/domain/session";

/**
 * ChatRole is the same role as everywhere else in the app now — see
 * src/domain/session/role.ts, the canonical definition. Re-exported under
 * this name so chat's existing call sites (permissions.ts, rooms.ts, the
 * chat UI) don't need to change; only session's own definition needs to
 * stay in sync with prisma/schema.prisma's ParticipantRole (see
 * tests/unit/session-domain-prisma-sync.test.ts).
 */
export const chatRoleSchema = participantRoleSchema;
export type ChatRole = z.infer<typeof chatRoleSchema>;

export { displayNameSchema };

export const chatChannelSchema = z.enum(["TEAM_A", "TEAM_B", "PUBLIC"]);
export type ChatChannel = z.infer<typeof chatChannelSchema>;

export const sendChatMessageSchema = z.object({
  channel: chatChannelSchema,
  body: z
    .string()
    .trim()
    .min(1, "Message can't be empty")
    .max(500, "Message is too long (max 500 characters)"),
});
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
