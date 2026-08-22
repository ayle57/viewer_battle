import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ContentError } from "@/domain/content";
import { deleteGeoMapAsset, listGeoMapAssets, MAX_UPLOAD_BYTES, saveUploadedGeoAsset } from "./geoAssets";

const MAPS_DIR = path.join(process.cwd(), "public", "images", "maps");

/**
 * Writes real files under the real `public/images/maps` (same directory
 * `listGeoMapAssets`/the round editor's asset picker actually scans) —
 * matching this codebase's convention of testing against the real
 * environment (Postgres for content.test.ts, sockets for
 * game-socket.test.ts) rather than mocking the filesystem. Every file
 * this suite creates is tracked and removed in `afterEach`, so it never
 * leaks into the real asset pool a Host would see in the UI.
 */
describe("saveUploadedGeoAsset", () => {
  const writtenUrls: string[] = [];

  afterEach(async () => {
    await Promise.all(
      writtenUrls.splice(0).map((url) => rm(path.join(MAPS_DIR, path.basename(url)), { force: true })),
    );
  });

  function fakeFile(name: string, type: string, bytes: number): File {
    return new File([new Uint8Array(bytes)], name, { type });
  }

  it("rejects a disallowed MIME type", async () => {
    await expect(saveUploadedGeoAsset(fakeFile("map.gif", "image/gif", 10))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("rejects an empty file", async () => {
    await expect(saveUploadedGeoAsset(fakeFile("map.jpg", "image/jpeg", 0))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("rejects a file over the size cap", async () => {
    await expect(saveUploadedGeoAsset(fakeFile("map.jpg", "image/jpeg", MAX_UPLOAD_BYTES + 1))).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });

  it("saves a valid image, sanitizing the filename and generating a collision-safe path", async () => {
    const asset = await saveUploadedGeoAsset(fakeFile("My Cool Map!! (final).jpg", "image/jpeg", 1024));
    writtenUrls.push(asset.url);

    expect(asset.name).toBe("My Cool Map!! (final).jpg"); // original name preserved for DISPLAY
    expect(asset.url).toMatch(/^\/images\/maps\/my-cool-map-final-[0-9a-f]{12}\.jpg$/); // but the PATH is sanitized + unique

    const written = await readFile(path.join(MAPS_DIR, path.basename(asset.url)));
    expect(written.length).toBe(1024);
  });

  it("two uploads of files with the same original name never collide", async () => {
    const first = await saveUploadedGeoAsset(fakeFile("dam.png", "image/png", 10));
    writtenUrls.push(first.url);
    const second = await saveUploadedGeoAsset(fakeFile("dam.png", "image/png", 10));
    writtenUrls.push(second.url);
    expect(first.url).not.toBe(second.url);
  });

  it("a saved upload is immediately visible to listGeoMapAssets", async () => {
    const asset = await saveUploadedGeoAsset(fakeFile("visible.webp", "image/webp", 10));
    writtenUrls.push(asset.url);
    const list = await listGeoMapAssets();
    expect(list.some((a) => a.url === asset.url)).toBe(true);
  });

  it("rejects a path-traversal filename without escaping the maps directory", async () => {
    const asset = await saveUploadedGeoAsset(fakeFile("../../../etc/evil.png", "image/png", 10));
    writtenUrls.push(asset.url);
    expect(asset.url.startsWith("/images/maps/")).toBe(true);
    expect(asset.url).not.toContain("..");
    // Actually landed inside MAPS_DIR, not escaped above it.
    const resolved = path.resolve(MAPS_DIR, path.basename(asset.url));
    expect(resolved.startsWith(MAPS_DIR)).toBe(true);
  });

  it("ContentError is the error type thrown for every validation failure", async () => {
    try {
      await saveUploadedGeoAsset(fakeFile("x.bmp", "image/bmp", 10));
      throw new Error("expected saveUploadedGeoAsset to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ContentError);
    }
  });
});

describe("deleteGeoMapAsset", () => {
  const writtenUrls: string[] = [];

  afterEach(async () => {
    await Promise.all(
      writtenUrls.splice(0).map((url) => rm(path.join(MAPS_DIR, path.basename(url)), { force: true })),
    );
  });

  function fakeFile(name: string, type: string, bytes: number): File {
    return new File([new Uint8Array(bytes)], name, { type });
  }

  it("removes a real uploaded asset from disk and from listGeoMapAssets", async () => {
    const asset = await saveUploadedGeoAsset(fakeFile("to-delete.jpg", "image/jpeg", 10));
    writtenUrls.push(asset.url);

    await deleteGeoMapAsset(asset.url);

    const list = await listGeoMapAssets();
    expect(list.some((a) => a.url === asset.url)).toBe(false);
    await expect(readFile(path.join(MAPS_DIR, path.basename(asset.url)))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("is idempotent — deleting a URL that's already gone is a silent success", async () => {
    await expect(deleteGeoMapAsset("/images/maps/already-gone-abc123.jpg")).resolves.toBeUndefined();
  });

  it("rejects a URL outside the maps directory without touching the filesystem", async () => {
    await expect(deleteGeoMapAsset("/images/sample/img.png")).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("can't be tricked into escaping the maps directory via a path-traversal URL", async () => {
    // path.basename strips any directory component, so this resolves to
    // deleting "public/images/maps/evil.png" (which doesn't exist —
    // idempotent success), never anything above MAPS_DIR.
    await expect(deleteGeoMapAsset("/images/maps/../../../etc/evil.png")).resolves.toBeUndefined();
  });
});
