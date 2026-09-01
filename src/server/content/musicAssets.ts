import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { ContentError } from "@/domain/content";

/**
 * The Music audio asset store — lists AND accepts uploads of whatever
 * audio files exist under `public/audio/music`, so the track editor's
 * picker never needs a hardcoded list. Same shape as geoAssets.ts (this
 * game's own image counterpart) — `saveUploadedMusicAsset` is the one
 * write path (src/app/api/content/music-assets/route.ts is its only
 * caller, gated behind a real ContentHost token — "le streamer
 * seulement," never a public upload endpoint); `listMusicAudioAssets` is
 * read-only and unauthed (contentMusicRouter.ts's `musicAsset.list` —
 * the pool of available clips isn't Host-owned content the way a
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
const MUSIC_DIR = path.join(process.cwd(), "public", "audio", "music");
const AUDIO_EXTENSIONS = new Set([".mp3", ".wav", ".ogg", ".m4a"]);

/** file.type (the browser-declared MIME) -> the extension we persist it under. Whitelist, not a blocklist — an upload with any other declared type is rejected outright. Covers every audio format an ordinary `<audio>` element plays natively across current browsers. */
const ALLOWED_MIME_EXT: Record<string, string> = {
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/x-wav": ".wav",
  "audio/wave": ".wav",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/x-m4a": ".m4a",
};

/**
 * A generous cap for an audio clip, not a hard product limit — the
 * product's own ask was deliberately loose ("entre 5s et 1min ou plus je
 * sais pas"). 25MB comfortably covers a full minute even as uncompressed
 * WAV (a minute of 44.1kHz/16-bit stereo is ~10.5MB) with real headroom
 * above that, while still bounding a pathological upload — same
 * "proportionate cap, not a content restriction" posture as
 * geoAssets.ts's own MAX_UPLOAD_BYTES.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export interface MusicAudioAsset {
  url: string;
  name: string;
}

export async function listMusicAudioAssets(): Promise<MusicAudioAsset[]> {
  let entries: string[];
  try {
    entries = await readdir(MUSIC_DIR);
  } catch {
    return []; // folder doesn't exist yet — an empty picker, not a crash
  }
  return entries
    .filter((file) => AUDIO_EXTENSIONS.has(path.extname(file).toLowerCase()))
    .sort()
    .map((file) => ({ url: `/audio/music/${file}`, name: file }));
}

/** Keeps only characters safe in a filename/URL segment, collapses everything else to "-", and bounds the length — the ORIGINAL name is never trusted as a path (no "..", no separators can survive this), only used to keep the persisted filename human-recognizable. Same as geoAssets.ts's own sanitizeBaseName. */
function sanitizeBaseName(originalName: string): string {
  const withoutExtension = originalName.replace(/\.[^./\\]+$/, "");
  const cleaned = withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return cleaned || "track";
}

/**
 * Persists one uploaded audio clip to the same directory
 * `listMusicAudioAssets` scans, under a generated collision-safe
 * filename — the original name is sanitized and kept as a human-readable
 * prefix, never trusted as the actual path. Validates type (whitelist,
 * by the browser-declared MIME — this endpoint is gated behind a real
 * ContentHost token, not a public surface, so this is proportionate, not
 * a hardened content-sniffing pipeline) and size before ever touching
 * disk. Throws `ContentError` ("VALIDATION") on anything that fails
 * either check, same vocabulary every other Content Studio write
 * already uses. No duration check at all — this app has no
 * audio-decoding dependency, and a Host who uploads a pre-trimmed clip
 * is trusted the same way a Host uploading a pre-cropped map image is.
 */
export async function saveUploadedMusicAsset(file: File): Promise<MusicAudioAsset> {
  const extension = ALLOWED_MIME_EXT[file.type];
  if (!extension) {
    throw new ContentError("VALIDATION", "Only MP3, WAV, OGG, or M4A audio files are accepted.");
  }
  if (file.size === 0) {
    throw new ContentError("VALIDATION", "That file is empty.");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ContentError("VALIDATION", `That clip is too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB).`);
  }

  const filename = `${sanitizeBaseName(file.name)}-${randomBytes(6).toString("hex")}${extension}`;
  await mkdir(MUSIC_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(MUSIC_DIR, filename), buffer);

  return { url: `/audio/music/${filename}`, name: file.name };
}

/**
 * Removes one clip from the shared pool — the streamer's own "clean up
 * the picker" action (contentMusicRouter.ts's `musicAsset.delete`, gated
 * behind a real ContentHost token, same posture as the upload).
 * Idempotent: deleting a URL that's already gone (a stale list, a
 * double-click) is a silent success, not an error. Doesn't check whether
 * any PlaylistTrack still references this URL first — same disclosed
 * scope boundary as geoAssets.ts's own deleteGeoMapAsset.
 */
export async function deleteMusicAudioAsset(url: string): Promise<void> {
  const filename = extractMusicFilename(url);
  if (!filename) {
    throw new ContentError("VALIDATION", "That doesn't look like an audio clip.");
  }
  try {
    await unlink(path.join(MUSIC_DIR, filename));
  } catch (error) {
    if (isEnoent(error)) return; // already gone — deleting is idempotent
    throw error;
  }
}

/**
 * Accepts only a URL of the exact shape this file itself hands out
 * ("/audio/music/<flat filename>") and returns just the filename.
 * `path.basename` strips any directory component, so a client-supplied
 * `url` (untrusted — this is what a DELETE request actually carries)
 * can never escape MUSIC_DIR via "../" or an absolute path, even though
 * every URL this app itself ever produces is already flat. Same as
 * geoAssets.ts's own extractMapsFilename.
 */
function extractMusicFilename(url: string): string | null {
  if (!url.startsWith("/audio/music/")) return null;
  const filename = path.basename(url);
  if (!filename || filename === "." || filename === "..") return null;
  return filename;
}

function isEnoent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code: unknown }).code === "ENOENT";
}
