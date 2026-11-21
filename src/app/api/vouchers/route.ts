import { NextResponse } from "next/server";
import { createVoucher, listVouchers, type VoucherWriteInput } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const vouchers = await listVouchers();
    return NextResponse.json(
      { vouchers },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/vouchers error:", err);
    return NextResponse.json(
      { error: "Failed to list vouchers." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<VoucherWriteInput>;
    const created = await createVoucher({
      code: String(body.code ?? ""),
      description: String(body.description ?? ""),
      discountType: body.discountType === "fixed" ? "fixed" : "percent",
      discountValue: Number(body.discountValue ?? 0),
      maxDiscount:
        body.maxDiscount !== undefined && body.maxDiscount !== null
          ? Number(body.maxDiscount)
          : null,
      minSubtotal: Number(body.minSubtotal ?? 0),
      scope: body.scope === "tags" ? "tags" : "global",
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
      usageLimit:
        body.usageLimit !== undefined && body.usageLimit !== null
          ? Number(body.usageLimit)
          : null,
      isActive: body.isActive !== false,
      expiresAt: body.expiresAt ? String(body.expiresAt) : null,
    });
    return NextResponse.json({ voucher: created }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gagal membuat voucher.";
    const status = message.includes("sudah terdaftar")
      ? 409
      : message.includes("harus") ||
        message.includes("minimal") ||
        message.includes("Tambahkan")
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
