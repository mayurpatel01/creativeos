// Gelato Ecommerce API client (template-based store products).
// Docs: https://dashboard.gelato.com/docs/ecommerce/products/create-from-template/
//
// Products are created inside a Gelato store from a template built in the Gelato
// dashboard. The template defines the garment, colors, sizes and print area; we
// supply the title and the design image for the template's image placeholder.

const GELATO_ECOMMERCE_URL = "https://ecommerce.gelatoapis.com/v1";

// Bella+Canvas 3001 Premium Unisex Crewneck (Black/White, S–2XL, front print).
export const DEFAULT_TEMPLATE_ID = "0b84fd43-7a70-49d6-85a4-c9d1a6c7b02a";

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

async function gelatoFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${GELATO_ECOMMERCE_URL}${path}`, {
    ...init,
    headers: {
      "X-API-KEY": apiKey(),
      "Content-Type": "application/json",
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(60_000),
  });

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
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

export function getTemplate(templateId: string = DEFAULT_TEMPLATE_ID): Promise<GelatoTemplate> {
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
  templateId?: string;
  tags?: string[];
  isVisibleInTheOnlineStore?: boolean;
};

// Places the design into every variant's image placeholder(s) and creates the
// product. Gelato returns immediately; variants and mockups are generated in
// the background (poll getProduct for status).
export async function createProduct(params: CreateProductParams): Promise<GelatoStoreProduct> {
  const templateId = params.templateId ?? DEFAULT_TEMPLATE_ID;
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
