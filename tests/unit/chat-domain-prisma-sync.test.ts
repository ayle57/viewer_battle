import { describe, expect, it } from "vitest";
import { chatChannelSchema, chatRoleSchema } from "@/domain/chat";
import { ChatChannel, ChatRole } from "@/generated/prisma/enums";

/**
 * The domain layer defines its own ChatRole/ChatChannel (see
 * src/domain/chat/schemas.ts) instead of importing the Prisma-generated
 * ones, to keep src/domain framework/ORM-agnostic. That means nothing
 * stops the two from drifting apart by hand-edit — this test is the
 * tripwire.
 */
describe("domain chat enums stay in sync with the Prisma schema", () => {
  it("ChatRole values match", () => {
    expect(chatRoleSchema.options.slice().sort()).toEqual(Object.values(ChatRole).slice().sort());
  });

  it("ChatChannel values match", () => {
    expect(chatChannelSchema.options.slice().sort()).toEqual(Object.values(ChatChannel).slice().sort());
  });
});
