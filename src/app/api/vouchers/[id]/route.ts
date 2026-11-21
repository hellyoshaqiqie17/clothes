import { NextResponse } from "next/server";
import { deleteVoucher, updateVoucher, type VoucherWriteInput } from "@/lib/db";
import { requireAdminSession } from "@/lib/memberAuth";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdminSession();
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    const body = (await req.json()) as Partial<VoucherWriteInput>;
    const updated = await updateVoucher(id, body);
    if (!updated) {
      return NextResponse.json(
        { error: "Voucher tidak ditemukan." },
        { status: 404 }
      );
    }
    return NextResponse.json({ voucher: updated });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gagal memperbarui voucher.";
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

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdminSession();
    if (!auth.ok) return auth.response;
    const { id } = await context.params;
    const removed = await deleteVoucher(id);
    if (!removed) {
      return NextResponse.json(
        { error: "Voucher tidak ditemukan." },
        { status: 404 }
      );
    }
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    console.error("DELETE /api/vouchers/[id] error:", err);
    return NextResponse.json(
      { error: "Gagal menghapus voucher." },
      { status: 500 }
    );
  }
}
