import { NextResponse } from "next/server";
import { getOrderById } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const order = await getOrderById(id);
    if (!order) {
      return NextResponse.json(
        { error: "No order found with that reference ID." },
        { status: 404 }
      );
    }
    return NextResponse.json(
      { order },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/orders/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to look up order." },
      { status: 500 }
    );
  }
}
