import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * Single Prisma client instance for the whole process.
 *
 * Prisma 7's default "prisma-client" generator requires an explicit driver
 * adapter instead of reading DATABASE_URL implicitly (see AGENTS.md —
 * "Prisma 7 driver adapters" for why this changed vs. older Prisma docs).
 *
 * In dev, tsx watch restarts the module on every file change, which would
 * otherwise create a new PrismaClient (and a new connection pool) per
 * reload. We stash the instance on `globalThis` to reuse it across reloads,
 * same as the standard Next.js + Prisma pattern.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
