import { NextResponse } from "next/server";
import { changeMemberPassword } from "@/lib/db";
import {
  getAuthenticatedMemberContext,
  getMemberSessionTokenFromCookies,
} from "@/lib/memberAuth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const ctx = await getAuthenticatedMemberContext();
    if (!ctx) {
      return NextResponse.json(
        { error: "Silakan login terlebih dahulu." },
        { status: 401 }
      );
    }

    const body = (await req.json()) as {
      currentPassword?: string;
      newPassword?: string;
    };

    const currentToken = await getMemberSessionTokenFromCookies();
    await changeMemberPassword({
      memberId: ctx.member.id,
      currentPassword: String(body.currentPassword ?? ""),
      newPassword: String(body.newPassword ?? ""),
      keepSessionToken: currentToken,
    });

    return NextResponse.json({
      ok: true,
      message: "Password berhasil diperbarui. Sesi di perangkat lain telah dicabut.",
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gagal memperbarui password.";
    const status =
      message.includes("salah") ||
      message.includes("minimal") ||
      message.includes("berbeda")
        ? 400
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
