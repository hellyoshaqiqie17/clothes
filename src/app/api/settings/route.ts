import { NextResponse } from "next/server";
import { getStoreSettings, updateStoreSettings } from "@/lib/db";
import type { StoreSettings } from "@/types/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = getStoreSettings();
    return NextResponse.json(
      { settings },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/settings error:", err);
    return NextResponse.json(
      { error: "Failed to load store settings." },
      { status: 500 }
    );
  }
}

export async function PATCH(req: Request) {
  try {
    const patch = (await req.json()) as Partial<StoreSettings>;
    const settings = updateStoreSettings(patch);
    return NextResponse.json({ settings });
  } catch (err) {
    console.error("PATCH /api/settings error:", err);
    return NextResponse.json(
      { error: "Failed to update store settings." },
      { status: 500 }
    );
  }
}
