import { NextResponse } from "next/server";
import { cancelOrderPaymentLocally, getOrderById } from "@/lib/db";
import { cancelGatewayPaymentBestEffort } from "@/lib/paymentService";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      orderId?: string;
      reason?: string;
      cancelOrder?: boolean;
    };
    const orderId = body.orderId?.trim();
    if (!orderId) {
      return NextResponse.json(
        { error: "orderId wajib diisi." },
        { status: 400 }
      );
    }

    const order = await getOrderById(orderId);
    if (!order) {
      return NextResponse.json(
        { error: "Order tidak ditemukan." },
        { status: 404 }
      );
    }

    const payment = order.payment ?? null;
    if (!payment) {
      return NextResponse.json(
        { error: "Order ini tidak memiliki transaksi pembayaran aktif." },
        { status: 400 }
      );
    }

    if (payment.status === "paid" || order.status === "confirmed" || order.status === "shipped") {
      return NextResponse.json(
        { error: "Pembayaran yang sudah lunas tidak dapat dibatalkan." },
        { status: 409 }
      );
    }

    const gatewayResult = await cancelGatewayPaymentBestEffort(
      payment,
      body.reason?.trim() || "Cancelled by customer"
    );

    const updated = await cancelOrderPaymentLocally({
      orderId: order.id,
      paymentId: payment.id,
      cancelOrder: Boolean(body.cancelOrder),
    });

    return NextResponse.json({
      ...updated,
      cancelledOnGateway: gatewayResult.cancelledOnGateway,
      gatewayError: gatewayResult.gatewayError,
    });
  } catch (err) {
    console.error("POST /api/payments/binderpay/cancel error:", err);
    return NextResponse.json(
      { error: "Gagal membatalkan pembayaran." },
      { status: 500 }
    );
  }
}
