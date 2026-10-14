import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  isValidAdminKey,
} from "@/lib/admin-auth";

function authenticate(request: NextRequest, key: string | null) {
  if (!isValidAdminKey(key)) {
    return NextResponse.redirect(new URL("/admin/login?error=1", request.url), 303);
  }

  const response = NextResponse.redirect(new URL("/admin", request.url), 303);
  response.cookies.set(ADMIN_COOKIE, key!, adminCookieOptions);
  return response;
}

// Login form submission.
export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const password = formData.get("password");
  return authenticate(request, typeof password === "string" ? password : null);
}

// /admin?adminKey=... is bounced here so the key becomes a cookie and drops out of the URL.
export async function GET(request: NextRequest) {
  return authenticate(request, request.nextUrl.searchParams.get("adminKey"));
}
