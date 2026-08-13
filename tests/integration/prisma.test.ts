import { describe, expect, it, afterAll } from "vitest";
import { prisma } from "@/server/db/client";

describe("Prisma <-> PostgreSQL (Phase 0 spike)", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("connects and can round-trip a real row", async () => {
    const created = await prisma.spikeCheck.create({
      data: { note: "phase-0 spike" },
    });
    expect(created.id).toBeTruthy();

    const found = await prisma.spikeCheck.findUnique({
      where: { id: created.id },
    });
    expect(found?.note).toBe("phase-0 spike");

    await prisma.spikeCheck.delete({ where: { id: created.id } });
  });
});
