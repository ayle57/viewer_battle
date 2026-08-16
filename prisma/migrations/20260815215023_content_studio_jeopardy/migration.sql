-- AlterTable
ALTER TABLE "SessionGame" ADD COLUMN     "playlistId" TEXT;

-- CreateTable
CREATE TABLE "ContentHost" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContentHost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "gameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Playlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistCategory" (
    "id" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PlaylistCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistQuestion" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "playlistId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "prompt" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "PlaylistQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContentHost_tokenHash_key" ON "ContentHost"("tokenHash");

-- CreateIndex
CREATE INDEX "Playlist_hostId_gameKey_idx" ON "Playlist"("hostId", "gameKey");

-- CreateIndex
CREATE INDEX "PlaylistCategory_playlistId_position_idx" ON "PlaylistCategory"("playlistId", "position");

-- CreateIndex
CREATE INDEX "PlaylistQuestion_categoryId_position_idx" ON "PlaylistQuestion"("categoryId", "position");

-- CreateIndex
CREATE INDEX "PlaylistQuestion_playlistId_idx" ON "PlaylistQuestion"("playlistId");

-- CreateIndex
CREATE INDEX "SessionGame_playlistId_idx" ON "SessionGame"("playlistId");

-- AddForeignKey
ALTER TABLE "SessionGame" ADD CONSTRAINT "SessionGame_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Playlist" ADD CONSTRAINT "Playlist_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "ContentHost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistCategory" ADD CONSTRAINT "PlaylistCategory_playlistId_fkey" FOREIGN KEY ("playlistId") REFERENCES "Playlist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistQuestion" ADD CONSTRAINT "PlaylistQuestion_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PlaylistCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
