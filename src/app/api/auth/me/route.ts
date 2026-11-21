import { NextResponse } from "next/server";
import { updateMemberProfile } from "@/lib/db";
import { getAuthenticatedMemberContext } from "@/lib/memberAuth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await getAuthenticatedMemberContext();
    if (!ctx) {
      return NextResponse.json(
        { member: null },
        { headers: { "Cache-Control": "no-store" } }
      );
    }
    return NextResponse.json(ctx, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("GET /api/auth/me error:", err);
    return NextResponse.json(
      { error: "Gagal memuat profil member." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await getAuthenticatedMemberContext();
    if (!ctx) {
      return NextResponse.json(
        { error: "Silakan login terlebih dahulu." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as {
      name?: string;
      phone?: string;
      defaultAddress?: string;
      defaultCity?: string;
    };

    const updated = await updateMemberProfile(ctx.member.id, body);
    if (!updated) {
      return NextResponse.json(
        { error: "Akun member tidak ditemukan." },
        { status: 404 }
      );
    }
    return NextResponse.json({ member: updated });
  } catch (err) {
    console.error("PATCH /api/auth/me error:", err);
    return NextResponse.json(
      { error: "Gagal memperbarui profil member." },
      { status: 500 }
    );
  }
}
