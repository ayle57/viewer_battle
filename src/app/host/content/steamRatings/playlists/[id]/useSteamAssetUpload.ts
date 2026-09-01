"use client";

import { useCallback, useState } from "react";

export interface UploadedSteamAsset {
  url: string;
  name: string;
}

interface UploadErrorBody {
  error?: { code: string; message: string };
}

/**
 * The client side of the upload endpoint (src/app/api/content/
 * steam-assets/route.ts) — plain `XMLHttpRequest`, not `fetch`, same
 * reasoning as ../../geoguessr/playlists/[id]/useGeoAssetUpload.ts /
 * ../../music/playlists/[id]/useMusicAssetUpload.ts: a genuine progress
 * event for an image that can be a few MB, not a silent spinner.
 * `progress` is 0..1, `null` once idle.
 */
export function useSteamAssetUpload(token: string) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const upload = useCallback(
    (file: File): Promise<UploadedSteamAsset | null> => {
      setUploading(true);
      setProgress(0);
      setError(null);

      return new Promise((resolve) => {
        const formData = new FormData();
        formData.append("file", file);

        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/content/steam-assets");
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);

        xhr.upload.addEventListener("progress", (event) => {
          if (event.lengthComputable) setProgress(event.loaded / event.total);
        });

        xhr.addEventListener("load", () => {
          setUploading(false);
          setProgress(null);
          let body: unknown;
          try {
            body = JSON.parse(xhr.responseText);
          } catch {
            body = null;
          }
          if (xhr.status >= 200 && xhr.status < 300 && body && typeof body === "object") {
            resolve(body as UploadedSteamAsset);
            return;
          }
          const message = (body as UploadErrorBody | null)?.error?.message ?? "Upload failed — try again.";
          setError(message);
          resolve(null);
        });

        xhr.addEventListener("error", () => {
          setUploading(false);
          setProgress(null);
          setError("Upload failed — check your connection and try again.");
          resolve(null);
        });

        xhr.send(formData);
      });
    },
    [token],
  );

  return { upload, uploading, progress, error, clearError: () => setError(null) };
}
