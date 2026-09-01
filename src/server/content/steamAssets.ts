import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ContentError } from "@/domain/content";

/**
 * The Steam Ratings cover-art asset store — lists AND accepts uploads of
 * whatever image files exist under `public/images/steam`, so the game
 * editor's picker never needs a hardcoded list. Same shape as
 * geoAssets.ts (GeoGuessr's own image counterpart) and musicAssets.ts
 * (Music's own audio counterpart) — `saveUploadedSteamAsset` is the one
 * write path (src/app/api/content/steam-assets/route.ts is its only
 * caller, gated behind a real ContentHost token — "le streamer
 * seulement," never a public upload endpoint); `listSteamCoverAssets` is
 * read-only and unauthed (contentSteamRouter.ts's `steamAsset.list` —
 * the pool of available covers isn't Host-owned content the way a
 * Playlist is, same posture as geoAssets.ts's own map pool).
 *
 * Deliberately still no cloud/object storage — same reasoning as
 * geoAssets.ts's own doc comment: this app has none elsewhere, and a
 * plain local directory is the honest continuation of that pattern
 * rather than standing up a bucket for one more folder of files. Same
 * disclosed tradeoff too: only persists across restarts if the
 * directory survives them (the Docker image's filesystem is ephemeral
 * unless volume-mounted).
 */
const STEAM_DIR = path.join(process.cwd(), "public", "images", "steam");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

/** file.type (the browser-declared MIME) -> the extension we persist it under. Whitelist, not a blocklist — an upload with any other declared type is rejected outright. */
const ALLOWED_MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

/**
 * A generous cap for cover art, not a hard product limit — a Steam
 * capsule/header image is typically well under 1MB; 20MB gives real
 * headroom above that (a Host cropping a high-res screenshot instead of
 * a real capsule, say) while still bounding a pathological upload — same
 * "proportionate cap, not a content restriction" posture as
 * musicAssets.ts's own MAX_UPLOAD_BYTES, just scaled down for a much
 * smaller asset type than a full audio clip or a GeoGuessr map.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface SteamCoverAsset {
  url: string;
  name: string;
}

export async function listSteamCoverAssets(): Promise<SteamCoverAsset[]> {
  let entries: string[];
  try {
    entries = await readdir(STEAM_DIR);
  } catch {
    return []; // folder doesn't exist yet — an empty picker, not a crash
  }
  return entries
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort()
    .map((file) => ({ url: `/images/steam/${file}`, name: file }));
}

/** Keeps only characters safe in a filename/URL segment, collapses everything else to "-", and bounds the length — the ORIGINAL name is never trusted as a path (no "..", no separators can survive this), only used to keep the persisted filename human-recognizable. Same as geoAssets.ts's own sanitizeBaseName. */
function sanitizeBaseName(originalName: string): string {
  const withoutExtension = originalName.replace(/\.[^./\\]+$/, "");
  const cleaned = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "cover";
}

/**
 * Persists one uploaded image to the same directory
 * `listSteamCoverAssets` scans, under a generated collision-safe
 * filename — the original name is sanitized and kept as a human-readable
 * prefix, never trusted as the actual path. Validates type (whitelist,
 * by the browser-declared MIME — this endpoint is gated behind a real
 * ContentHost token, not a public surface, so this is proportionate, not
 * a hardened content-sniffing pipeline) and size before ever touching
 * disk. Throws `ContentError` ("VALIDATION") on anything that fails
 * either check, same vocabulary every other Content Studio write already
 * uses.
 */
export async function saveUploadedSteamAsset(file: File): Promise<SteamCoverAsset> {
  const extension = ALLOWED_MIME_EXT[file.type];
  if (!extension) {
    throw new ContentError("VALIDATION", "Only JPEG, PNG, WEBP, or AVIF images are accepted.");
  }
  if (file.size === 0) {
    throw new ContentError("VALIDATION", "That file is empty.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ContentError("VALIDATION", `That image is too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB).`);
  }

  const filename = `${sanitizeBaseName(file.name)}-${randomBytes(6).toString("hex")}${extension}`;
  await mkdir(STEAM_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(STEAM_DIR, filename), buffer);

  return { url: `/images/steam/${filename}`, name: file.name };
}

/**
 * Removes one cover from the shared pool — the streamer's own "clean up
 * the picker" action (contentSteamRouter.ts's `steamAsset.delete`, gated
 * behind a real ContentHost token, same posture as the upload).
 * Idempotent: deleting a URL that's already gone (a stale list, a
 * double-click) is a silent success, not an error. Doesn't check whether
 * any PlaylistSteamGame still references this URL first — same disclosed
 * scope boundary as geoAssets.ts's own deleteGeoMapAsset.
 */
export async function deleteSteamCoverAsset(url: string): Promise<void> {
  const filename = extractSteamFilename(url);
  if (!filename) {
    throw new ContentError("VALIDATION", "That doesn't look like a cover image.");
  }
  try {
    await unlink(path.join(STEAM_DIR, filename));
  } catch (error) {
    if (isEnoent(error)) return; // already gone — deleting is idempotent
    throw error;
  }
}

/**
 * Accepts only a URL of the exact shape this file itself hands out
 * ("/images/steam/<flat filename>") and returns just the filename.
 * `path.basename` strips any directory component, so a client-supplied
 * `url` (untrusted — this is what a DELETE request actually carries)
 * can never escape STEAM_DIR via "../" or an absolute path, even though
 * every URL this app itself ever produces is already flat. Same as
 * geoAssets.ts's own extractMapsFilename.
 */
function extractSteamFilename(url: string): string | null {
  if (!url.startsWith("/images/steam/")) return null;
  const filename = path.basename(url);
  if (!filename || filename === "." || filename === "..") return null;
  return filename;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT";
}
