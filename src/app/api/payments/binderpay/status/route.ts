import { NextResponse } from "next/server";
import { syncOrderPaymentStatus } from "@/lib/paymentService";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const orderId = searchParams.get("orderId")?.trim();
    if (!orderId) {
      return NextResponse.json(
        { error: "Parameter orderId wajib diisi." },
        { status: 400 }
      );
    }

    const result = await syncOrderPaymentStatus(orderId);
    if (!result.order) {
      return NextResponse.json(
        { error: "Order tidak ditemukan." },
        { status: 404 }
      );
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("GET /api/payments/binderpay/status error:", err);
    return NextResponse.json(
      { error: "Gagal memeriksa status pembayaran." },
      { status: 500 }
    );
  }
}
