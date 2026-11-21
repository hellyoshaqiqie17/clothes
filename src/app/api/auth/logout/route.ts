import { NextResponse } from "next/server";
import { logoutMemberSession } from "@/lib/db";
import {
  clearMemberSessionCookie,
  getMemberSessionTokenFromCookies,
} from "@/lib/memberAuth";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const token = await getMemberSessionTokenFromCookies();
    if (token) {
      await logoutMemberSession(token);
    }
    const res = NextResponse.json({ ok: true });
    clearMemberSessionCookie(res);
    return res;
  } catch (err) {
    console.error("POST /api/auth/logout error:", err);
    const res = NextResponse.json({ ok: true });
    clearMemberSessionCookie(res);
    return res;
  }
}
