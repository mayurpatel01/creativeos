import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "adminKey";

export function isValidAdminKey(value: string | undefined | null): boolean {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey || !value) return false;

  const a = Buffer.from(value);
  const b = Buffer.from(adminKey);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function hasAdminCookie(): Promise<boolean> {
  const cookieStore = await cookies();
  return isValidAdminKey(cookieStore.get(ADMIN_COOKIE)?.value);
}

export const adminCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
};
