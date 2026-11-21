import { cookies } from "next/headers";
import { NextResponse } from "next/server";
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

export async function requireAdminSession(): Promise<
  | { ok: true; member: MemberProfile }
  | { ok: false; response: NextResponse }
> {
  const ctx = await getAuthenticatedMemberContext();
  if (!ctx) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Autentikasi admin diperlukan. Silakan login terlebih dahulu." },
        { status: 401 }
      ),
    };
  }
  if (ctx.member.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Akses ditolak. Hanya akun admin yang diizinkan." },
        { status: 403 }
      ),
    };
  }
  return { ok: true, member: ctx.member };
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
