-- CreateTable
CREATE TABLE "PlaylistRound" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT,
    "imageUrl" TEXT,
    "targetX" DOUBLE PRECISION,
    "targetY" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaylistRound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaylistRound_playlistId_position_idx" ON "PlaylistRound"("playlistId", "position");

-- AddForeignKey
ALTER TABLE "PlaylistRound" ADD CONSTRAINT "PlaylistRound_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
