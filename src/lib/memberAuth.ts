import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getMemberContextBySessionToken } from "@/lib/db";
import type { BagItem, MemberProfile } from "@/types/catalog";

export const MEMBER_SESSION_COOKIE = "meridian_member_token";
const MEMBER_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

export async function getMemberSessionTokenFromCookies(): Promise<
  string | undefined
> {
  const cookieStore = await cookies();
  return cookieStore.get(MEMBER_SESSION_COOKIE)?.value;
}

export async function getAuthenticatedMemberContext(): Promise<{
  member: MemberProfile;
  bagItems: BagItem[];
  wishlistIds: string[];
} | null> {
  const token = await getMemberSessionTokenFromCookies();
  if (!token) return null;
  return getMemberContextBySessionToken(token);
}

export function setMemberSessionCookie(
  res: NextResponse,
  rawToken: string
): void {
  res.cookies.set(MEMBER_SESSION_COOKIE, rawToken, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MEMBER_COOKIE_MAX_AGE,
  });
}

export function clearMemberSessionCookie(res: NextResponse): void {
  res.cookies.set(MEMBER_SESSION_COOKIE, "", {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
  });
}
