import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  isValidAdminKey,
} from "@/lib/admin-auth";

function safeNext(next: string | null): string {
  // Only allow relative paths that start with / to prevent open redirects.
  if (next && /^\/[^/]/.test(next)) return next;
  return "/admin";
}

function authenticate(request: NextRequest, key: string | null, next: string | null) {
  if (!isValidAdminKey(key)) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("error", "1");
    if (next) loginUrl.searchParams.set("next", next);
    return NextResponse.redirect(loginUrl, 303);
  }

  const response = NextResponse.redirect(new URL(safeNext(next), request.url), 303);
  response.cookies.set(ADMIN_COOKIE, key!, adminCookieOptions);
  return response;
}

// Login form submission.
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = formData.get("password");
  const next = formData.get("next");
  return authenticate(
    request,
    typeof password === "string" ? password : null,
    typeof next === "string" ? next : null,
  );
}

// /admin?adminKey=... is bounced here so the key becomes a cookie and drops out of the URL.
export async function GET(request: NextRequest) {
  return authenticate(
    request,
    request.nextUrl.searchParams.get("adminKey"),
    request.nextUrl.searchParams.get("next"),
  );
}
