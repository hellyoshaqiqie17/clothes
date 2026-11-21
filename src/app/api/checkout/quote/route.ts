import { NextResponse } from "next/server";
import { prepareOrderQuote } from "@/lib/db";
import { getAuthenticatedMemberContext } from "@/lib/memberAuth";
import type { BagItem } from "@/types/catalog";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      items?: BagItem[];
      voucherCode?: string;
    };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "Keranjang belanja kosong." },
        { status: 400 }
      );
    }

    const memberCtx = await getAuthenticatedMemberContext();
    const quote = await prepareOrderQuote(body.items, {
      member: memberCtx?.member ?? null,
      voucherCode: body.voucherCode ?? null,
      requireValidVoucher: false,
    });

    return NextResponse.json(
      {
        pricing: quote.pricing,
        member: memberCtx?.member ?? null,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Gagal menghitung total belanja.";
    const status = message.includes("no longer available") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
