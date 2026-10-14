"use client";

import { useRef, useState } from "react";
import {
  DESIGN_BUCKET,
  MAX_DESIGN_BYTES,
  designObjectUrl,
  designStoragePath,
} from "@/lib/design-storage";
import { saveFileUrl } from "./actions";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

class UploadError extends Error {}

async function readPng(file: File): Promise<{ width: number; height: number }> {
  if (!file.name.toLowerCase().endsWith(".png") || (file.type && file.type !== "image/png")) {
    throw new UploadError("Only .png files are allowed.");
  }
  if (file.size > MAX_DESIGN_BYTES) {
    throw new UploadError("That file is over the 50 MB limit.");
  }

  // The extension and MIME type come from the filename, so check the actual bytes too.
  const header = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (!PNG_SIGNATURE.every((byte, i) => header[i] === byte)) {
    throw new UploadError("That file isn't a valid PNG.");
  }

  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    throw new UploadError("Couldn't read that PNG. It may be corrupted.");
  }
}

// supabase-js has no upload progress callback, so this calls the same Storage
// endpoint it uses, via XHR, to get progress events.
function uploadWithProgress(
  path: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    xhr.open("POST", `${SUPABASE_URL}/storage/v1/object/${DESIGN_BUCKET}/${encodedPath}`);
    xhr.setRequestHeader("Authorization", `Bearer ${SUPABASE_ANON_KEY}`);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    // Never overwrite: an existing file has to be cleared by the admin.
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) return resolve();

      let body: { error?: string; message?: string; statusCode?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      console.error("[designer portal] storage upload failed", xhr.status, body);

      if (xhr.status === 409 || body.statusCode === "409" || body.error === "Duplicate") {
        reject(new UploadError("A file is already stored for this design. Ask the admin to clear it."));
      } else if (xhr.status === 401 || xhr.status === 403 || body.statusCode === "403") {
        reject(new UploadError("Uploads aren't allowed yet (storage permissions)."));
      } else {
        reject(new UploadError(body.message ?? `Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new UploadError("Network error during upload."));

    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", file);
    xhr.send(form);
  });
}

export function UploadButton({
  token,
  assetId,
  god,
  suggestedFilename,
  initialFilePath,
  locked,
  onUploaded,
}: {
  token: string;
  assetId: string;
  god: string | null;
  suggestedFilename: string;
  initialFilePath: string | null;
  locked: boolean;
  onUploaded: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploadedPath, setUploadedPath] = useState(initialFilePath);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (uploadedPath) {
    const name = uploadedPath.split("/").pop();
    return (
      <div className="min-w-0">
        <div className="text-xs font-medium whitespace-nowrap text-[#7bd67f]">✓ Uploaded</div>
        <div className="truncate font-mono text-[11px] text-neutral-500" title={name}>
          {name}
        </div>
      </div>
    );
  }

  if (locked) return <span className="text-neutral-600">—</span>;

  const canUpload = Boolean(god && suggestedFilename);
  const uploading = progress !== null;

  async function handleFile(file: File) {
    setError(null);
    setProgress(0);
    try {
      const { width, height } = await readPng(file);
      const path = designStoragePath(god!, suggestedFilename);
      await uploadWithProgress(path, file, setProgress);

      const result = await saveFileUrl(
        token,
        assetId,
        designObjectUrl(SUPABASE_URL, path),
        width,
        height,
      );
      if (!result.ok) throw new UploadError(result.error);

      setUploadedPath(path);
      onUploaded();
    } catch (err) {
      setError(err instanceof UploadError ? err.message : "Upload failed. Try again.");
      if (!(err instanceof UploadError)) console.error("[designer portal] upload error", err);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="min-w-[130px]">
      <input
        ref={inputRef}
        type="file"
        accept=".png,image/png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />
      {uploading ? (
        <div aria-live="polite">
          <div className="text-xs tabular-nums text-[#c9a84c]">Uploading… {progress}%</div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-neutral-800">
            <div
              className="h-full rounded-full bg-[#c9a84c] transition-[width]"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={!canUpload}
          title={canUpload ? undefined : "This design is missing its god or filename."}
          className="rounded-md border border-[#c9a84c]/50 px-3 py-1.5 text-xs font-medium whitespace-nowrap text-[#c9a84c] transition hover:bg-[#c9a84c] hover:text-[#0a0a0a] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#c9a84c]"
        >
          Upload PNG
        </button>
      )}
      {error && (
        <p role="alert" className="mt-1 max-w-[220px] text-[11px] text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
