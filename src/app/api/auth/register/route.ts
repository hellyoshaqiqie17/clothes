import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getShoppingSession, registerMember } from "@/lib/db";
import { setMemberSessionCookie } from "@/lib/memberAuth";
import type { BagItem } from "@/types/catalog";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      name?: string;
      email?: string;
      phone?: string;
      password?: string;
      bagItems?: BagItem[];
      wishlistIds?: string[];
    };

    const cookieStore = await cookies();
    const sid = cookieStore.get("meridian_sid")?.value;
    const guestSession = sid ? await getShoppingSession(sid) : null;

    const guestBag =
      Array.isArray(body.bagItems) && body.bagItems.length > 0
        ? body.bagItems
        : guestSession?.bagItems ?? [];
    const guestWishlist =
      Array.isArray(body.wishlistIds) && body.wishlistIds.length > 0
        ? body.wishlistIds.map(String)
        : guestSession?.wishlistIds ?? [];

    const result = await registerMember({
      name: String(body.name ?? ""),
      email: String(body.email ?? ""),
      phone: String(body.phone ?? ""),
      password: String(body.password ?? ""),
      guestBag,
      guestWishlist,
    });

    const res = NextResponse.json(
      {
        member: result.member,
        bagItems: result.bagItems,
        wishlistIds: result.wishlistIds,
      },
      { status: 201 }
    );
    setMemberSessionCookie(res, result.rawToken);
    return res;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gagal mendaftarkan akun member.";
    const status =
      message.includes("sudah terdaftar")
        ? 409
        : message.includes("minimal") || message.includes("valid")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
