import { NextResponse } from "next/server";
import { ContentError } from "@/domain/content";
import { resolveContentHost } from "@/server/db/contentHost";
import { MAX_UPLOAD_BYTES, saveUploadedMusicAsset } from "@/server/content/musicAssets";
import { logger } from "@/server/logger";

/**
 * The one write path for Music audio clips ("le streamer seulement" —
 * gated behind a real ContentHost bearer token, the exact same identity
 * every other Content Studio mutation resolves, never a public upload
 * endpoint). A plain Next.js Route Handler, not tRPC — same reasoning as
 * src/app/api/content/geo-assets/route.ts's own doc comment: tRPC's
 * procedures are JSON-in/JSON-out and have no multipart/binary story,
 * while a Route Handler's `Request` is a real Fetch API Request —
 * `await request.formData()` parses `multipart/form-data` natively.
 *
 * The actual save (validation + writing to disk) lives in
 * src/server/content/musicAssets.ts's `saveUploadedMusicAsset` — this
 * handler is purely auth + request/response plumbing around it, same
 * "the route never contains the rule" posture as every tRPC procedure in
 * this app.
 */
export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;
  if (!token) {
    return errorResponse("INVALID_CONTENT_TOKEN", "This Content Studio session is invalid or has expired.", 401);
  }
  try {
    await resolveContentHost(token);
  } catch {
    return errorResponse("INVALID_CONTENT_TOKEN", "This Content Studio session is invalid or has expired.", 401);
  }

  // A cheap, early rejection when the browser sends a real Content-Length
  // — avoids buffering an egregiously oversized body into memory just to
  // reject it a moment later in saveUploadedMusicAsset's own size check.
  // Same posture as geo-assets/route.ts's own early check.
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return errorResponse("VALIDATION", `That clip is too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB).`, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("VALIDATION", "Couldn't read that upload — try again.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse("VALIDATION", "No audio file was included in the upload.", 400);
  }

  try {
    const asset = await saveUploadedMusicAsset(file);
    return NextResponse.json(asset);
  } catch (error) {
    if (error instanceof ContentError) {
      return errorResponse(error.code, error.message, 400);
    }
    logger.error({ error }, "music asset upload failed");
    return errorResponse("INTERNAL_ERROR", "Upload failed — try again.", 500);
  }
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}
