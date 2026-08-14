import { z } from "zod";

/**
 * Canonical chat role/channel types, owned by the domain layer.
 *
 * These deliberately don't import the Prisma-generated enums (see
 * src/generated/prisma/enums.ts) — the domain must stay framework/ORM
 * agnostic. The string values are kept in sync with prisma/schema.prisma
 * by hand; tests/unit/chat-domain-prisma-sync.test.ts fails loudly if they
 * ever drift apart.
 */
export const chatRoleSchema = z.enum(["HOST", "TEAM_A", "TEAM_B", "DISPLAY"]);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatChannelSchema = z.enum(["TEAM_A", "TEAM_B", "PUBLIC"]);
export type ChatChannel = z.infer<typeof chatChannelSchema>;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name is required")
  .max(40, "Display name is too long (max 40 characters)");

export const sendChatMessageSchema = z.object({
  channel: chatChannelSchema,
  body: z
    .string()
    .trim()
    .min(1, "Message can't be empty")
    .max(500, "Message is too long (max 500 characters)"),
});
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;
