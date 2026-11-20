import { NextResponse } from "next/server";
import { deleteProduct, getProductById, updateProduct } from "@/lib/db";
import type { CatalogProduct, GarmentCut, ProductBadge } from "@/types/catalog";

export const dynamic = "force-dynamic";

const VALID_CUTS = new Set<GarmentCut>([
  "tee",
  "longsleeve",
  "knit",
  "hoodie",
  "jacket",
  "baggy-denim",
  "cargo",
  "trouser",
  "shorts",
]);

export async function GET(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const product = getProductById(id);
    if (!product) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }
    return NextResponse.json(
      { product },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/products/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to fetch product." },
      { status: 500 }
    );
  }
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const raw = (await req.json()) as Partial<
      Omit<CatalogProduct, "badge" | "compareAtPrice">
    > & {
      badge?: ProductBadge | null | "";
      compareAtPrice?: number | null;
    };

    if (raw.title !== undefined && !String(raw.title).trim()) {
      return NextResponse.json(
        { error: "Product name cannot be empty." },
        { status: 400 }
      );
    }

    if (raw.price !== undefined) {
      const num = Number(raw.price);
      if (!Number.isFinite(num) || num < 10000) {
        return NextResponse.json(
          { error: "Price must be at least Rp 10.000." },
          { status: 400 }
        );
      }
      raw.price = Math.round(num);
    }

    if (raw.cut !== undefined && !VALID_CUTS.has(raw.cut)) {
      return NextResponse.json(
        { error: "Invalid garment cut selected." },
        { status: 400 }
      );
    }

    const normalizedBadge: ProductBadge | null | undefined =
      raw.badge === null || raw.badge === ""
        ? null
        : raw.badge === "NEW" ||
          raw.badge === "BEST SELLER" ||
          raw.badge === "LIMITED"
        ? raw.badge
        : undefined;

    const normalizedCompareAt: number | null | undefined =
      raw.compareAtPrice === null
        ? null
        : raw.compareAtPrice !== undefined && Number.isFinite(Number(raw.compareAtPrice))
        ? Math.round(Number(raw.compareAtPrice))
        : undefined;

    const updated = updateProduct(id, {
      ...raw,
      badge: normalizedBadge,
      compareAtPrice: normalizedCompareAt,
    });
    if (!updated) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }
    return NextResponse.json({ product: updated });
  } catch (err) {
    console.error("PATCH /api/products/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to update product." },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const deleted = deleteProduct(id);
    if (!deleted) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    console.error("DELETE /api/products/[id] error:", err);
    return NextResponse.json(
      { error: "Failed to delete product." },
      { status: 500 }
    );
  }
}
