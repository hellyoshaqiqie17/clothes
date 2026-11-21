import { NextResponse } from "next/server";
import { listMemberOrders } from "@/lib/db";
import { getAuthenticatedMemberContext } from "@/lib/memberAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getAuthenticatedMemberContext();
    if (!ctx) {
      return NextResponse.json(
        { error: "Silakan login untuk melihat riwayat pembelian." },
        { status: 401 }
      );
    }

    const orders = await listMemberOrders(ctx.member.id, ctx.member.email);
    return NextResponse.json(
      { orders, member: ctx.member },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/member/orders error:", err);
    return NextResponse.json(
      { error: "Gagal memuat riwayat pembelian." },
      { status: 500 }
    );
  }
}
