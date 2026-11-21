import { NextResponse } from "next/server";
import { getBinderPayConfigStatus, resolveSiteOrigin } from "@/lib/binderpay";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const origin = resolveSiteOrigin(req);
    const config = getBinderPayConfigStatus(origin);
    return NextResponse.json(config, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("GET /api/payments/binderpay/config error:", err);
    return NextResponse.json(
      { error: "Failed to load BinderPay configuration." },
      { status: 500 }
    );
  }
}
