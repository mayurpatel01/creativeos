// Gelato Ecommerce API client (template-based store products).
// Docs: https://dashboard.gelato.com/docs/ecommerce/products/create-from-template/
//
// Products are created inside a Gelato store from a template built in the Gelato
// dashboard. The template defines the garment, colors, sizes and print area; we
// supply the title and the design image for the template's image placeholder.

const GELATO_ECOMMERCE_URL = "https://ecommerce.gelatoapis.com/v1";

// One Gelato template per print size: FULL designs print full-front, CHEST
// designs as a chest print. Both are set in the environment.
export const GELATO_TEMPLATE_ID_FULL = process.env.GELATO_TEMPLATE_ID_FULL;
export const GELATO_TEMPLATE_ID_CHEST = process.env.GELATO_TEMPLATE_ID_CHEST;

// The original full-front template (Bella+Canvas 3001, Black/White, S–2XL), used
// for FULL designs until GELATO_TEMPLATE_ID_FULL is set.
const LEGACY_FULL_TEMPLATE_ID = "0b84fd43-7a70-49d6-85a4-c9d1a6c7b02a";

let warnedFullFallback = false;

export type TemplateChoice = { templateId: string; size: "FULL" | "CHEST" };

// Picks the template for a design's size_variant. Unknown sizes use FULL with a
// warning. A CHEST design with no CHEST template is an error rather than being
// printed full-front by mistake.
export function templateForSizeVariant(sizeVariant: string | null | undefined): TemplateChoice {
  const size = sizeVariant?.trim().toUpperCase();

  if (size === "CHEST") {
    if (!GELATO_TEMPLATE_ID_CHEST) {
      throw new GelatoError(
        "GELATO_TEMPLATE_ID_CHEST is not set, so CHEST designs can't be sent to Gelato yet.",
      );
    }
    return { templateId: GELATO_TEMPLATE_ID_CHEST, size: "CHEST" };
  }

  if (size !== "FULL") {
    console.warn(`[gelato] unknown size_variant ${JSON.stringify(sizeVariant)}; using the FULL template`);
  }
  if (!GELATO_TEMPLATE_ID_FULL && !warnedFullFallback) {
    warnedFullFallback = true;
    console.warn(`[gelato] GELATO_TEMPLATE_ID_FULL is not set; using the original template ${LEGACY_FULL_TEMPLATE_ID}`);
  }
  return { templateId: GELATO_TEMPLATE_ID_FULL ?? LEGACY_FULL_TEMPLATE_ID, size: "FULL" };
}

// Intended retail prices. The create-from-template endpoint has no documented
// price field, so these are not sent; set them on the template or store in the
// Gelato dashboard. Kept here so the pricing rule lives in one place.
export const RETAIL_PRICING_USD = { standard: 29.99, plusSize: 32.99 } as const;
const PLUS_SIZES = new Set(["2XL", "3XL", "4XL", "5XL"]);

export function retailPriceForSize(size: string): number {
  return PLUS_SIZES.has(size.toUpperCase()) ? RETAIL_PRICING_USD.plusSize : RETAIL_PRICING_USD.standard;
}

export class GelatoError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

function apiKey(): string {
  const key = process.env.GELATO_API_KEY;
  if (!key) throw new GelatoError("GELATO_API_KEY is not set.");
  return key;
}

export function storeId(): string {
  const id = process.env.GELATO_STORE_ID;
  if (!id) {
    throw new GelatoError(
      "GELATO_STORE_ID is not set. Create or connect a store in Gelato and add its ID to the environment.",
    );
  }
  return id;
}

// Gelato doesn't publish rate limits or send rate-limit headers (checked
// 2026-10-15); throttling comes back as HTTP 429. So calls are spaced out, any
// standard rate-limit headers Gelato adds later are watched, and a 429 is
// retried once.
const MIN_CALL_INTERVAL_MS = 500;
const RATE_LIMIT_WARN_FRACTION = 0.2;
const DEFAULT_RETRY_AFTER_MS = 2_000;
const MAX_RETRY_AFTER_MS = 30_000;

// Next time a call may start. Shared by every Gelato call in this server
// process, so bulk approvals, the review queue and status sync all queue
// behind each other at least MIN_CALL_INTERVAL_MS apart.
let nextCallAt = 0;

async function waitForCallSlot(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextCallAt);
  nextCallAt = slot + MIN_CALL_INTERVAL_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
}

// Warns when standard rate-limit headers (if Gelato ever sends them) show
// little allowance left.
function checkRateLimitHeaders(response: Response, path: string): void {
  const read = (...names: string[]) => {
    for (const name of names) {
      const value = Number(response.headers.get(name));
      if (response.headers.has(name) && Number.isFinite(value)) return value;
    }
    return null;
  };
  const remaining = read("x-ratelimit-remaining", "ratelimit-remaining", "x-rate-limit-remaining");
  const limit = read("x-ratelimit-limit", "ratelimit-limit", "x-rate-limit-limit");
  if (remaining === null) return;
  if (remaining <= 0 || (limit && remaining / limit < RATE_LIMIT_WARN_FRACTION)) {
    console.warn(
      `[gelato] rate limit close: ${remaining}${limit ? ` of ${limit}` : ""} requests left (${path})`,
    );
  }
}

function retryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Math.min(Math.max(ms, 0) || DEFAULT_RETRY_AFTER_MS, MAX_RETRY_AFTER_MS);
}

async function gelatoFetch<T>(path: string, init: RequestInit = {}, attempt = 1): Promise<T> {
  await waitForCallSlot();
  const response = await fetch(`${GELATO_ECOMMERCE_URL}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": apiKey(),
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });
  checkRateLimitHeaders(response, path);

  // Throttled: the request wasn't processed, so one retry is safe even for POSTs.
  if (response.status === 429 && attempt === 1) {
    const wait = retryAfterMs(response);
    console.warn(`[gelato] rate limited (429) on ${init.method ?? "GET"} ${path}; retrying in ${wait} ms`);
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, wait));
    nextCallAt = Math.max(nextCallAt, Date.now() + MIN_CALL_INTERVAL_MS);
    return gelatoFetch<T>(path, init, attempt + 1);
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    if (response.status === 429) {
      console.warn(`[gelato] still rate limited (429) on ${init.method ?? "GET"} ${path} after retrying`);
    }
    const message =
      (body as { message?: string } | null)?.message ?? (typeof body === "string" ? body : "") ?? "";
    throw new GelatoError(`Gelato API ${response.status}${message ? `: ${message}` : ""}`, response.status, body);
  }
  return body as T;
}

export type GelatoTemplate = {
  id: string;
  title: string;
  variants: Array<{
    id: string;
    title: string;
    variantOptions: Array<{ name: string; value: string }>;
    imagePlaceholders: Array<{ name: string; printArea: string; width: number; height: number }>;
  }>;
};

export type GelatoStoreProduct = {
  id: string;
  storeId?: string;
  externalId?: string | null;
  title?: string;
  status?: string;
  publishingErrorCode?: string | null;
  previewUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
  variants?: Array<{ id: string; title?: string; productUid?: string }>;
  [key: string]: unknown;
};

// Templates rarely change, so cache them for the life of the server process.
const templateCache = new Map<string, Promise<GelatoTemplate>>();

export function getTemplate(templateId: string): Promise<GelatoTemplate> {
  let cached = templateCache.get(templateId);
  if (!cached) {
    cached = gelatoFetch<GelatoTemplate>(`/templates/${encodeURIComponent(templateId)}`);
    cached.catch(() => templateCache.delete(templateId));
    templateCache.set(templateId, cached);
  }
  return cached;
}

export type CreateProductParams = {
  title: string;
  description?: string;
  // Public URL Gelato downloads the design from. Must be a plain URL with no
  // query string; see publishDesignImage in lib/gelato/public-image.ts.
  imageUrl: string;
  // From templateForSizeVariant().
  templateId: string;
  tags?: string[];
  isVisibleInTheOnlineStore?: boolean;
};

// Places the design into every variant's image placeholder(s) and creates the
// product. Gelato returns immediately; variants and mockups are generated in
// the background (poll getProduct for status).
export async function createProduct(params: CreateProductParams): Promise<GelatoStoreProduct> {
  const { templateId } = params;
  const template = await getTemplate(templateId);
  if (!template.variants?.length) {
    throw new GelatoError(`Template ${templateId} has no variants.`);
  }

  const variants = template.variants.map((variant) => {
    if (!variant.imagePlaceholders?.length) {
      throw new GelatoError(`Template variant "${variant.title}" has no image placeholder.`);
    }
    return {
      templateVariantId: variant.id,
      // Placeholder names come from the template's layer names, so read them
      // from the template rather than hard-coding them.
      imagePlaceholders: variant.imagePlaceholders.map((placeholder) => ({
        name: placeholder.name,
        fileUrl: params.imageUrl,
      })),
    };
  });

  return gelatoFetch<GelatoStoreProduct>(`/stores/${encodeURIComponent(storeId())}/products:create-from-template`, {
    method: "POST",
    body: JSON.stringify({
      templateId,
      title: params.title,
      description: params.description ?? "",
      isVisibleInTheOnlineStore: params.isVisibleInTheOnlineStore ?? false,
      tags: params.tags ?? [],
      variants,
    }),
  });
}

export function getProduct(gelatoProductId: string): Promise<GelatoStoreProduct> {
  return gelatoFetch<GelatoStoreProduct>(
    `/stores/${encodeURIComponent(storeId())}/products/${encodeURIComponent(gelatoProductId)}`,
  );
}

// The API profile documents no product URL; use one only if Gelato returns it.
export function productUrlFrom(product: GelatoStoreProduct): string | null {
  for (const key of ["productUrl", "url", "previewUrl", "externalPreviewUrl"]) {
    const value = product[key];
    if (typeof value === "string" && /^https?:\/\//.test(value)) return value;
  }
  return null;
}
