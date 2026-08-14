import { describe, expect, it } from "vitest";
import { participantRoleSchema } from "@/domain/session";
import { chatChannelSchema } from "@/domain/chat";
import { ParticipantRole, ChatChannel } from "@/generated/prisma/enums";

/**
 * The domain layer defines its own ParticipantRole/ChatChannel (see
 * src/domain/session/role.ts, src/domain/chat/schemas.ts) instead of
 * importing the Prisma-generated ones, to keep src/domain framework/ORM
 * agnostic. That means nothing stops the two from drifting apart by
 * hand-edit — this test is the tripwire. (ChatRole used to be its own
 * copy here too; it's now just an alias of ParticipantRole — see
 * src/domain/chat/schemas.ts — so there is nothing separate left to sync.)
 */
describe("domain enums stay in sync with the Prisma schema", () => {
  it("ParticipantRole values match", () => {
    expect(participantRoleSchema.options.slice().sort()).toEqual(Object.values(ParticipantRole).slice().sort());
  });

  it("ChatChannel values match", () => {
    expect(chatChannelSchema.options.slice().sort()).toEqual(Object.values(ChatChannel).slice().sort());
  });
});
