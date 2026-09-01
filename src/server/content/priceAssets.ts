import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ContentError } from "@/domain/content";

/**
 * The Guess the Price photo asset store — lists AND accepts uploads of
 * whatever image files exist under `public/images/price`, so the item
 * editor's picker never needs a hardcoded list. Same shape as
 * steamAssets.ts (Steam Ratings' own cover-art counterpart) and
 * geoAssets.ts/musicAssets.ts — `saveUploadedPriceAsset` is the one
 * write path (src/app/api/content/price-assets/route.ts is its only
 * caller, gated behind a real ContentHost token — "le streamer
 * seulement," never a public upload endpoint); `listPriceAssets` is
 * read-only and unauthed (contentPriceRouter.ts's `priceAsset.list` —
 * the pool of available photos isn't Host-owned content the way a
 * Playlist is, same posture as steamAssets.ts's own cover pool).
 *
 * Deliberately still no cloud/object storage — same reasoning as
 * steamAssets.ts's own doc comment: this app has none elsewhere, and a
 * plain local directory is the honest continuation of that pattern
 * rather than standing up a bucket for one more folder of files. Same
 * disclosed tradeoff too: only persists across restarts if the
 * directory survives them (the Docker image's filesystem is ephemeral
 * unless volume-mounted).
 */
const PRICE_DIR = path.join(process.cwd(), "public", "images", "price");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

/** file.type (the browser-declared MIME) -> the extension we persist it under. Whitelist, not a blocklist — an upload with any other declared type is rejected outright. */
const ALLOWED_MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

/**
 * A generous cap for a product photo, not a hard product limit — same
 * "proportionate cap, not a content restriction" posture as
 * steamAssets.ts's own MAX_UPLOAD_BYTES.
 */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface PricePhotoAsset {
  url: string;
  name: string;
}

export async function listPriceAssets(): Promise<PricePhotoAsset[]> {
  let entries: string[];
  try {
    entries = await readdir(PRICE_DIR);
  } catch {
    return []; // folder doesn't exist yet — an empty picker, not a crash
  }
  return entries
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort()
    .map((file) => ({ url: `/images/price/${file}`, name: file }));
}

/** Keeps only characters safe in a filename/URL segment, collapses everything else to "-", and bounds the length — the ORIGINAL name is never trusted as a path (no "..", no separators can survive this), only used to keep the persisted filename human-recognizable. Same as steamAssets.ts's own sanitizeBaseName. */
function sanitizeBaseName(originalName: string): string {
  const withoutExtension = originalName.replace(/\.[^./\\]+$/, "");
  const cleaned = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "item";
}

/**
 * Persists one uploaded image to the same directory `listPriceAssets`
 * scans, under a generated collision-safe filename — the original name
 * is sanitized and kept as a human-readable prefix, never trusted as the
 * actual path. Validates type (whitelist, by the browser-declared
 * MIME — this endpoint is gated behind a real ContentHost token, not a
 * public surface, so this is proportionate, not a hardened
 * content-sniffing pipeline) and size before ever touching disk. Throws
 * `ContentError` ("VALIDATION") on anything that fails either check,
 * same vocabulary every other Content Studio write already uses.
 */
export async function saveUploadedPriceAsset(file: File): Promise<PricePhotoAsset> {
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
  await mkdir(PRICE_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(PRICE_DIR, filename), buffer);

  return { url: `/images/price/${filename}`, name: file.name };
}

/**
 * Removes one photo from the shared pool — the streamer's own "clean up
 * the picker" action (contentPriceRouter.ts's `priceAsset.delete`, gated
 * behind a real ContentHost token, same posture as the upload).
 * Idempotent: deleting a URL that's already gone (a stale list, a
 * double-click) is a silent success, not an error. Doesn't check whether
 * any PlaylistPriceItem still references this URL first — same
 * disclosed scope boundary as steamAssets.ts's own deleteSteamCoverAsset.
 */
export async function deletePriceAsset(url: string): Promise<void> {
  const filename = extractPriceFilename(url);
  if (!filename) {
    throw new ContentError("VALIDATION", "That doesn't look like an item photo.");
  }
  try {
    await unlink(path.join(PRICE_DIR, filename));
  } catch (error) {
    if (isEnoent(error)) return; // already gone — deleting is idempotent
    throw error;
  }
}

/**
 * Accepts only a URL of the exact shape this file itself hands out
 * ("/images/price/<flat filename>") and returns just the filename.
 * `path.basename` strips any directory component, so a client-supplied
 * `url` (untrusted — this is what a DELETE request actually carries)
 * can never escape PRICE_DIR via "../" or an absolute path, even though
 * every URL this app itself ever produces is already flat. Same as
 * steamAssets.ts's own extractSteamFilename.
 */
function extractPriceFilename(url: string): string | null {
  if (!url.startsWith("/images/price/")) return null;
  const filename = path.basename(url);
  if (!filename || filename === "." || filename === "..") return null;
  return filename;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT";
}
