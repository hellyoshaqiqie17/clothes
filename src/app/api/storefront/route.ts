import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getStorefrontData } from "@/lib/db";
import { MEMBER_SESSION_COOKIE } from "@/lib/memberAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const cookieStore = await cookies();
    const sid = cookieStore.get("meridian_sid")?.value;
    const memberToken = cookieStore.get(MEMBER_SESSION_COOKIE)?.value;
    const data = await getStorefrontData(sid, memberToken);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("GET /api/storefront error:", err);
    return NextResponse.json(
      { error: "Failed to load storefront data from database." },
      { status: 500 }
    );
  }
}
