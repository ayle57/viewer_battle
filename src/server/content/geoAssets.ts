import { mkdir, readdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ContentError } from "@/domain/content";

/**
 * The GeoGuessr map asset store — lists AND now accepts uploads of
 * whatever image files exist under `public/images/maps`, so the round
 * editor's picker never needs a hardcoded list (see PlaylistRound's own
 * doc comment on `imageUrl` being an opaque string, not a foreign key).
 * `saveUploadedGeoAsset` is the one write path
 * (src/app/api/content/geo-assets/route.ts is its only caller, gated
 * behind a real ContentHost token — "le streamer seulement," never a
 * public upload endpoint); `listGeoMapAssets` is read-only and unauthed
 * (contentGeoRouter.ts's `geoAsset.list` — the pool of available images
 * isn't Host-owned content the way a Playlist is, same posture as a
 * stock asset library).
 *
 * Deliberately still no cloud/object storage — this app has none
 * elsewhere (AGENTS.md: no new infra without a measured reason), and a
 * plain local directory is the honest continuation of "the demo image
 * already lives under public/images/maps" rather than standing up a
 * bucket for one folder of files. The real, disclosed tradeoff: this
 * only persists across restarts if the directory survives them — native
 * `pnpm start` and dev both write straight to the real `public/`
 * checkout, but the Docker image's filesystem is ephemeral unless
 * `docker-compose.yml` volume-mounts this exact path (it does — see
 * that file's `app` service).
 */
const MAPS_DIR = path.join(process.cwd(), "public", "images", "maps");
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);

/** file.type (the browser-declared MIME) -> the extension we persist it under. Whitelist, not a blocklist — an upload with any other declared type is rejected outright. */
const ALLOWED_MIME_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/avif": ".avif",
};

/**
 * "Haute qualité" is the whole point of this feature — no resizing/
 * recompression happens here (see ClickableImageMap's own doc comment on
 * why it renders a plain `<img>`, which is what makes byte-for-byte
 * quality meaningful to preserve). This cap exists only to bound a
 * pathological upload, not to discourage a genuinely large map — the
 * reference asset this shipped with is ~37MB; 100MB gives real headroom
 * above that without being unbounded.
 */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface GeoMapAsset {
  url: string;
  name: string;
}

export async function listGeoMapAssets(): Promise<GeoMapAsset[]> {
  let entries: string[];
  try {
    entries = await readdir(MAPS_DIR);
  } catch {
    return []; // folder doesn't exist yet — an empty picker, not a crash
  }
  return entries
    .filter((file) => IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort()
    .map((file) => ({ url: `/images/maps/${file}`, name: file }));
}

/** Keeps only characters safe in a filename/URL segment, collapses everything else to "-", and bounds the length — the ORIGINAL name is never trusted as a path (no "..", no separators can survive this), only used to keep the persisted filename human-recognizable. */
function sanitizeBaseName(originalName: string): string {
  const withoutExtension = originalName.replace(/\.[^./\\]+$/, "");
  const cleaned = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "map";
}

/**
 * Persists one uploaded image to the same directory `listGeoMapAssets`
 * scans, under a generated collision-safe filename — the original name
 * is sanitized and kept as a human-readable prefix, never trusted as the
 * actual path. Validates type (whitelist, by the browser-declared MIME —
 * this endpoint is gated behind a real ContentHost token, not a public
 * surface, so this is proportionate, not a hardened content-sniffing
 * pipeline) and size before ever touching disk. Throws `ContentError`
 * ("VALIDATION") on anything that fails either check, same vocabulary
 * every other Content Studio write already uses.
 */
export async function saveUploadedGeoAsset(file: File): Promise<GeoMapAsset> {
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
  await mkdir(MAPS_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(MAPS_DIR, filename), buffer);

  return { url: `/images/maps/${filename}`, name: file.name };
}
