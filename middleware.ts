import { NextResponse, type NextRequest } from "next/server";

// Cookie name must match ADMIN_COOKIE in lib/admin-auth.ts.
// We can't import that module here because it uses node:crypto,
// which is unavailable in the Edge Runtime.
const ADMIN_COOKIE = "adminKey";

// Routes always allowed through (login UI + auth API)
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/api/admin/auth"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/admin")) return NextResponse.next();

  if (PUBLIC_ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Just check presence — key comparison happens in server actions + API routes
  // which run in Node.js and can use timingSafeEqual.
  if (!request.cookies.get(ADMIN_COOKIE)?.value) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*"],
};
