-- CreateTable
CREATE TABLE "PlaylistSteamGame" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT,
    "imageUrl" TEXT,
    "ratings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaylistSteamGame_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaylistSteamGame_playlistId_position_idx" ON "PlaylistSteamGame"("playlistId", "position");

-- AddForeignKey
ALTER TABLE "PlaylistSteamGame" ADD CONSTRAINT "PlaylistSteamGame_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
