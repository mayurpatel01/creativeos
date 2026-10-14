// Shared by the browser upload and the server action, so both agree on paths.

export const DESIGN_BUCKET = "assets";

// Matches the bucket's file_size_limit.
export const MAX_DESIGN_BYTES = 50 * 1024 * 1024;

export function designStoragePath(god: string, suggestedFilename: string): string {
  return `designs/${god}/${suggestedFilename}`;
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

// Storage REST endpoint for the object. The bucket is private, so viewing it needs
// a signed URL or an authorized request; this is the canonical location.
export function designObjectUrl(supabaseUrl: string, path: string): string {
  return `${supabaseUrl}/storage/v1/object/${DESIGN_BUCKET}/${encodePath(path)}`;
}

// Public copies of designs for print partners (Gelato) that need a plain URL
// they can download without a token. Only designs sent to Gelato are copied
// here; the main bucket stays private.
export const PUBLIC_DESIGN_BUCKET = "designs";

// "designs/GANESH/x.png" in the private bucket → "GANESH/x.png" in the public one.
export function publicDesignPath(filePath: string): string {
  return filePath.replace(/^designs\//, "");
}

export function publicDesignUrl(supabaseUrl: string, filePath: string): string {
  return `${supabaseUrl}/storage/v1/object/public/${PUBLIC_DESIGN_BUCKET}/${encodePath(publicDesignPath(filePath))}`;
}
