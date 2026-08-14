-- Hand-edited from the Prisma-generated version: prisma migrate diffed
-- this as "drop ChatRole enum, create ParticipantRole enum, drop+recreate
-- ChatMessage.role" (lossy — errors on existing data) instead of the
-- simple rename it actually is (same values, new name). Renaming the
-- type in place keeps ChatMessage.role's existing data untouched and
-- needs no ChatMessage-table statements at all.
ALTER TYPE "ChatRole" RENAME TO "ParticipantRole";

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('CREATED', 'ACTIVE', 'FINISHED');

-- AlterTable
-- updatedAt needs a real value for the existing rows; DEFAULT
-- CURRENT_TIMESTAMP covers that. Prisma's `@updatedAt` still sets it
-- explicitly from the client on every future update regardless of this
-- column default.
ALTER TABLE "Session" ADD COLUMN     "status" "SessionStatus" NOT NULL DEFAULT 'CREATED',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "Participant" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" "ParticipantRole" NOT NULL,
    "seat" INTEGER,
    "displayName" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Participant_tokenHash_key" ON "Participant"("tokenHash");

-- CreateIndex
CREATE INDEX "Participant_sessionId_role_idx" ON "Participant"("sessionId", "role");

-- CreateIndex
-- Enforces "max 2 players per team": NULL never equals NULL in a unique
-- index, so HOST/DISPLAY rows (seat: null) never collide here — this
-- only ever restricts TEAM_A/TEAM_B to at most 2 distinct seat values.
CREATE UNIQUE INDEX "Participant_sessionId_role_seat_key" ON "Participant"("sessionId", "role", "seat");

-- CreateIndex (hand-written, not expressible via @@unique in schema.prisma)
-- Enforces "exactly 1 host per session": a plain @@unique on
-- (sessionId, role) would also wrongly cap TEAM_A/TEAM_B at 1 and
-- DISPLAY at 1, so this is scoped to HOST only via a partial index.
CREATE UNIQUE INDEX "Participant_host_per_session" ON "Participant"("sessionId") WHERE "role" = 'HOST';

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
