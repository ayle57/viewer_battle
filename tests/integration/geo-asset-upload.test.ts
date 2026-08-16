import { rm } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/content/geo-assets/route";
import { createContentHost } from "@/server/db/contentHost";
import { DEV_PLAYGROUND_HOST_PASSWORD } from "@/domain/session";
import { prisma } from "@/server/db/client";

const MAPS_DIR = path.join(process.cwd(), "public", "images", "maps");

/**
 * The upload Route Handler (src/app/api/content/geo-assets/route.ts) end
 * to end — called directly as a plain function with a real Fetch API
 * `Request`, no HTTP server needed (a Next.js Route Handler export IS
 * just an async function of `Request -> Response`), same reasoning
 * content.test.ts uses for calling tRPC procedures directly via
 * `appRouter.createCaller({})`. Covers what the small `geoAssets.test.ts`
 * unit suite can't: the auth gate ("le streamer seulement") and the
 * actual HTTP status codes/response shape a real client gets.
 */
describe("POST /api/content/geo-assets", () => {
  const writtenPaths: string[] = [];
  // Scoped to rows created from THIS moment on — never a blanket
  // `contentHost.deleteMany({})`. This app has exactly ONE real
  // ContentHost (the streamer); a global wipe here was the actual bug
  // behind "playlists keep disappearing" — see content.test.ts's
  // identical comment for the full story. A timestamp cutoff, not
  // per-call `hostId` tracking — exhaustive by construction.
  const suiteStartedAt = new Date();

  afterEach(async () => {
    await Promise.all(writtenPaths.splice(0).map((p) => rm(p, { force: true })));
  });

  afterAll(async () => {
    await prisma.contentHost.deleteMany({ where: { createdAt: { gte: suiteStartedAt } } });
    await prisma.$disconnect();
  });

  async function freshHost() {
    const { token } = await createContentHost(DEV_PLAYGROUND_HOST_PASSWORD);
    return token;
  }

  function requestWithFile(token: string | null, file: File | null): Request {
    const formData = new FormData();
    if (file) formData.append("file", file);
    const headers = new Headers();
    if (token) headers.set("authorization", `Bearer ${token}`);
    return new Request("http://localhost/api/content/geo-assets", { method: "POST", headers, body: formData });
  }

  async function trackWritten(response: Response) {
    if (response.status !== 200) return;
    const body = (await response.clone().json()) as { url: string };
    writtenPaths.push(path.join(MAPS_DIR, path.basename(body.url)));
  }

  it("rejects a request with no token at all (401)", async () => {
    const file = new File([new Uint8Array(10)], "map.jpg", { type: "image/jpeg" });
    const response = await POST(requestWithFile(null, file));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe("INVALID_CONTENT_TOKEN");
  });

  it("rejects a request with a bogus token (401) — never writes a file", async () => {
    const file = new File([new Uint8Array(10)], "map.jpg", { type: "image/jpeg" });
    const response = await POST(requestWithFile("not-a-real-token", file));
    expect(response.status).toBe(401);
  });

  it("rejects a valid token but no file (400)", async () => {
    const token = await freshHost();
    const response = await POST(requestWithFile(token, null));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION");
  });

  it("rejects a disallowed file type even with a valid token (400)", async () => {
    const token = await freshHost();
    const file = new File([new Uint8Array(10)], "map.gif", { type: "image/gif" });
    const response = await POST(requestWithFile(token, file));
    expect(response.status).toBe(400);
  });

  it("a real, authenticated upload succeeds and returns a usable URL", async () => {
    const token = await freshHost();
    const file = new File([new Uint8Array(2048)], "Real Streamer Map.png", { type: "image/png" });
    const response = await POST(requestWithFile(token, file));
    await trackWritten(response);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.url).toMatch(/^\/images\/maps\/.+\.png$/);
    expect(body.name).toBe("Real Streamer Map.png");
  });
});
