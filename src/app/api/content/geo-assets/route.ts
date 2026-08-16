import { NextResponse } from "next/server";
import { ContentError } from "@/domain/content";
import { resolveContentHost } from "@/server/db/contentHost";
import { MAX_UPLOAD_BYTES, saveUploadedGeoAsset } from "@/server/content/geoAssets";
import { logger } from "@/server/logger";

/**
 * The one write path for GeoGuessr map images ("le streamer seulement" —
 * gated behind a real ContentHost bearer token, the exact same identity
 * every other Content Studio mutation resolves, never a public upload
 * endpoint). A plain Next.js Route Handler, not tRPC: tRPC's procedures
 * are JSON-in/JSON-out (see contentGeoRouter.ts) and have no multipart/
 * binary story, while a Route Handler's `Request` is a real Fetch API
 * Request — `await request.formData()` parses `multipart/form-data`
 * natively, no upload middleware/dependency needed.
 *
 * The actual save (validation + writing to disk) lives in
 * src/server/content/geoAssets.ts's `saveUploadedGeoAsset` — this
 * handler is purely auth + request/response plumbing around it, same
 * "the route never contains the rule" posture as every tRPC procedure
 * in this app.
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
  // (it does for a FormData body built from a File/Blob) — avoids
  // buffering an egregiously oversized body into memory just to reject it
  // a moment later in saveUploadedGeoAsset's own size check. Not a
  // substitute for that check (a missing/lying header can't be trusted),
  // just a fast path for the common, honest case.
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES) {
    return errorResponse("VALIDATION", `That image is too large (max ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))}MB).`, 413);
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse("VALIDATION", "Couldn't read that upload — try again.", 400);
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return errorResponse("VALIDATION", "No image file was included in the upload.", 400);
  }

  try {
    const asset = await saveUploadedGeoAsset(file);
    return NextResponse.json(asset);
  } catch (error) {
    if (error instanceof ContentError) {
      return errorResponse(error.code, error.message, 400);
    }
    logger.error({ error }, "geo asset upload failed");
    return errorResponse("INTERNAL_ERROR", "Upload failed — try again.", 500);
  }
}

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}
