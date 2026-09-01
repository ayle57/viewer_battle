-- CreateTable
CREATE TABLE "PlaylistPriceItem" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT,
    "imageUrl" TEXT,
    "price" DOUBLE PRECISION,
    "marginPercent" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaylistPriceItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlaylistPriceItem_playlistId_position_idx" ON "PlaylistPriceItem"("playlistId", "position");

-- AddForeignKey
ALTER TABLE "PlaylistPriceItem" ADD CONSTRAINT "PlaylistPriceItem_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
