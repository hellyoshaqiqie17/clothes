import crypto from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
  getShoppingSession,
  saveMemberBagWishlist,
  saveShoppingSession,
} from "@/lib/db";
import { getAuthenticatedMemberContext } from "@/lib/memberAuth";
import type { BagItem } from "@/types/catalog";

export const dynamic = "force-dynamic";

const SESSION_COOKIE = "meridian_sid";
const VALID_SID = /^[a-zA-Z0-9_-]{8,64}$/;

async function getOrCreateSessionId(): Promise<{
  sessionId: string;
  isNew: boolean;
}> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(SESSION_COOKIE)?.value;
  if (existing && VALID_SID.test(existing)) {
    return { sessionId: existing, isNew: false };
  }
  return {
    sessionId: `sid_${crypto.randomBytes(12).toString("hex")}`,
    isNew: true,
  };
}

export async function GET() {
  try {
    const memberCtx = await getAuthenticatedMemberContext();
    if (memberCtx) {
      return NextResponse.json(
        {
          bagItems: memberCtx.bagItems,
          wishlistIds: memberCtx.wishlistIds,
          member: memberCtx.member,
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const { sessionId, isNew } = await getOrCreateSessionId();
    const session = await getShoppingSession(sessionId);
    const res = NextResponse.json(session, {
      headers: { "Cache-Control": "no-store" },
    });
    if (isNew) {
      res.cookies.set(SESSION_COOKIE, sessionId, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
      });
    }
    return res;
  } catch (err) {
    console.error("GET /api/session error:", err);
    return NextResponse.json(
      { error: "Failed to load shopping session." },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as {
      bagItems?: BagItem[];
      wishlistIds?: string[];
    };
    const bagItems = Array.isArray(body.bagItems) ? body.bagItems : [];
    const wishlistIds = Array.isArray(body.wishlistIds)
      ? body.wishlistIds.map(String)
      : [];

    const memberCtx = await getAuthenticatedMemberContext();
    if (memberCtx) {
      const saved = await saveMemberBagWishlist(
        memberCtx.member.id,
        bagItems,
        wishlistIds
      );
      return NextResponse.json(saved, {
        headers: { "Cache-Control": "no-store" },
      });
    }

    const { sessionId, isNew } = await getOrCreateSessionId();
    const saved = await saveShoppingSession(sessionId, bagItems, wishlistIds);
    const res = NextResponse.json(saved, {
      headers: { "Cache-Control": "no-store" },
    });
    if (isNew) {
      res.cookies.set(SESSION_COOKIE, sessionId, {
        path: "/",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
        httpOnly: true,
      });
    }
    return res;
  } catch (err) {
    console.error("PUT /api/session error:", err);
    return NextResponse.json(
      { error: "Failed to save shopping session." },
      { status: 500 }
    );
  }
}
