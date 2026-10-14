"use client";

import { useEffect, useRef, useState } from "react";
import { getSignedImageUrls } from "./actions";

// Signed URLs are fetched lazily as thumbnails scroll into view. Requests made
// close together are combined into one server action call, and results are
// cached until shortly before they expire.

const BATCH_DELAY_MS = 40;
const EXPIRY_MARGIN_MS = 60_000;

const cache = new Map<string, { url: string | null; expiresAt: number }>();
let queue = new Map<string, Array<(url: string | null) => void>>();
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  const batch = queue;
  queue = new Map();
  timer = null;

  const paths = [...batch.keys()];
  const result = await getSignedImageUrls(paths).catch(() => null);
  for (const path of paths) {
    const url = result?.ok ? (result.urls[path] ?? null) : null;
    if (result?.ok) cache.set(path, { url, expiresAt: result.expiresAt });
    for (const resolve of batch.get(path) ?? []) resolve(url);
  }
}

function requestSignedUrl(path: string, force = false): Promise<string | null> {
  const cached = cache.get(path);
  if (!force && cached && cached.expiresAt - EXPIRY_MARGIN_MS > Date.now()) {
    return Promise.resolve(cached.url);
  }
  return new Promise((resolve) => {
    queue.set(path, [...(queue.get(path) ?? []), resolve]);
    timer ??= setTimeout(() => void flush(), BATCH_DELAY_MS);
  });
}

// Checkerboard so transparent backgrounds are visible.
export const CHECKERBOARD =
  "bg-[conic-gradient(#2a2a2a_25%,#1c1c1c_0_50%,#2a2a2a_0_75%,#1c1c1c_0)] bg-[length:16px_16px]";

export function Thumbnail({
  filePath,
  alt,
  onOpen,
}: {
  filePath: string;
  alt: string;
  onOpen: (url: string) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<"waiting" | "loading" | "ready" | "error">("waiting");
  const retried = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();
        setState("loading");
        void requestSignedUrl(filePath).then((signed) => {
          if (cancelled) return;
          setUrl(signed);
          setState(signed ? "ready" : "error");
        });
      },
      { rootMargin: "200px" },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [filePath]);

  // A cached URL can expire while the page sits open; fetch a fresh one once.
  function handleImageError() {
    if (retried.current) {
      setState("error");
      return;
    }
    retried.current = true;
    void requestSignedUrl(filePath, true).then((signed) => {
      setUrl(signed);
      setState(signed ? "ready" : "error");
    });
  }

  return (
    <button
      ref={ref}
      type="button"
      onClick={() => url && onOpen(url)}
      disabled={state !== "ready"}
      aria-label={`Preview ${alt}`}
      title={state === "error" ? "Couldn't load preview" : undefined}
      className={`flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-neutral-800 transition enabled:hover:border-[#c9a84c] ${CHECKERBOARD}`}
    >
      {state === "ready" && url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived; skip image optimization
        <img
          src={url}
          alt={alt}
          width={64}
          height={64}
          loading="lazy"
          onError={handleImageError}
          className="h-full w-full object-contain"
        />
      ) : state === "error" ? (
        <span className="text-xs text-red-300">!</span>
      ) : (
        <span className="h-full w-full animate-pulse bg-neutral-800/60" />
      )}
    </button>
  );
}

export function ImageLightbox({
  url,
  designNumber,
  filename,
  onClose,
}: {
  url: string;
  designNumber: number | null;
  filename: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Design ${designNumber ?? ""} preview`}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full max-w-3xl flex-col rounded-xl border border-neutral-800 bg-[#111] p-4 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-lg font-semibold text-[#c9a84c]">
              {designNumber === null ? "—" : `#${designNumber}`}
            </p>
            <p className="truncate font-mono text-xs text-neutral-400" title={filename}>
              {filename}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm text-neutral-300 transition hover:border-[#c9a84c] hover:text-[#c9a84c]"
          >
            Close
          </button>
        </div>
        <div className={`mt-4 flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-lg ${CHECKERBOARD}`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed URLs are short-lived; skip image optimization */}
          <img src={url} alt={filename} className="max-h-[75vh] w-auto max-w-full object-contain" />
        </div>
      </div>
    </div>
  );
}
