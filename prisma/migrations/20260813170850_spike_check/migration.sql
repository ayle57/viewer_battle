-- CreateTable
CREATE TABLE "SpikeCheck" (
    "id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpikeCheck_pkey" PRIMARY KEY ("id")
);
