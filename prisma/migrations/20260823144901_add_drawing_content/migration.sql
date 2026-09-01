-- CreateTable
CREATE TABLE "PlaylistPrompt" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT,
    "durationSeconds" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaylistPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaylistPrompt_playlistId_position_idx" ON "PlaylistPrompt"("playlistId", "position");

-- AddForeignKey
ALTER TABLE "PlaylistPrompt" ADD CONSTRAINT "PlaylistPrompt_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
