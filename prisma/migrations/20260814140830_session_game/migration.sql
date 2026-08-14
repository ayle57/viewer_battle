-- CreateEnum
CREATE TYPE "SessionGameStatus" AS ENUM ('IN_PROGRESS', 'FINISHED');

-- AlterTable
ALTER TABLE "Session" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "SessionGame" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "status" "SessionGameStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "internalState" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SessionGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionGame_sessionId_startedAt_idx" ON "SessionGame"("sessionId", "startedAt");

-- AddForeignKey
ALTER TABLE "SessionGame" ADD CONSTRAINT "SessionGame_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
