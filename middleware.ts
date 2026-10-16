import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin-auth";

// Routes that are always public (login page + auth API)
const PUBLIC_ADMIN_PATHS = ["/admin/login", "/api/admin/auth"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only gate /admin/* routes
  if (!pathname.startsWith("/admin")) return NextResponse.next();

  // Allow login page and auth endpoint through
  if (PUBLIC_ADMIN_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Check for valid admin cookie — any non-empty value is forwarded;
  // the actual key comparison happens in isValidAdminKey on the page/API.
  // Middleware just needs to know "is there a cookie at all" to prevent
  // unauthenticated access to the admin UI.
  const cookie = request.cookies.get(ADMIN_COOKIE);
  if (!cookie?.value) {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  // Match all /admin routes; exclude static assets
  matcher: ["/admin/:path*"],
};
