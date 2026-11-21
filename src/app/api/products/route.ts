import { NextResponse } from "next/server";
import { createProduct, listProducts } from "@/lib/db";
import { requireAdminSession } from "@/lib/memberAuth";
import { createDefaultMapping } from "@/data/catalogProducts";
import type { CatalogProduct, GarmentCut } from "@/types/catalog";

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

export async function GET() {
  try {
    const products = await listProducts();
    return NextResponse.json(
      { products },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/products error:", err);
    return NextResponse.json(
      { error: "Failed to list products." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireAdminSession();
    if (!auth.ok) return auth.response;
    const body = (await req.json()) as Partial<CatalogProduct>;
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json(
        { error: "Product name is required." },
        { status: 400 }
      );
    }

    const price = Number(body.price);
    if (!Number.isFinite(price) || price < 10000) {
      return NextResponse.json(
        { error: "Price must be at least Rp 10.000." },
        { status: 400 }
      );
    }

    const category = body.category === "bottom" ? "bottom" : "top";
    const cut: GarmentCut =
      body.cut && VALID_CUTS.has(body.cut)
        ? body.cut
        : category === "top"
        ? "tee"
        : "baggy-denim";

    const collection =
      body.collection === "best-sellers" || body.collection === "limited"
        ? body.collection
        : "new-arrivals";

    const defaultSizes =
      category === "top" ? ["S", "M", "L", "XL"] : ["28", "30", "32", "34"];
    const sizes =
      Array.isArray(body.sizes) && body.sizes.length > 0
        ? body.sizes.map((s) => String(s).trim()).filter(Boolean)
        : defaultSizes;

    const baseHex = body.mapping?.baseColorHex || "#D8D4CC";
    const mapping = createDefaultMapping(
      baseHex,
      body.mapping?.detectedFabricLabel || "STUDIO GARMENT PHOTO",
      body.mapping
    );

    const compareAt =
      body.compareAtPrice !== undefined && Number(body.compareAtPrice) > price
        ? Math.round(Number(body.compareAtPrice))
        : undefined;

    const created = await createProduct({
      title,
      brand:
        typeof body.brand === "string" && body.brand.trim()
          ? body.brand.trim()
          : "MERIDIAN",
      season:
        typeof body.season === "string" && body.season.trim()
          ? body.season.trim()
          : "SS27",
      category,
      cut,
      collection,
      badge:
        body.badge === "NEW" ||
        body.badge === "BEST SELLER" ||
        body.badge === "LIMITED"
          ? body.badge
          : undefined,
      colorTag:
        typeof body.colorTag === "string" && body.colorTag.trim()
          ? body.colorTag.trim()
          : "CUSTOM FABRIC",
      price: Math.round(price),
      compareAtPrice: compareAt,
      stockStatus:
        body.stockStatus === "Limited Stock" ? "Limited Stock" : "In Stock",
      description:
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : "Contemporary ready-to-wear piece with studio photos and interactive 3D preview.",
      sizes,
      selectedSize:
        typeof body.selectedSize === "string" && sizes.includes(body.selectedSize)
          ? body.selectedSize
          : sizes[0],
      presetKind: body.presetKind || "custom",
      mapping,
      isFeatured: Boolean(body.isFeatured),
      isUserPublished: Boolean(body.isUserPublished),
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : 0,
      tags: Array.isArray(body.tags) ? body.tags.map(String) : [],
    });

    return NextResponse.json({ product: created }, { status: 201 });
  } catch (err) {
    console.error("POST /api/products error:", err);
    return NextResponse.json(
      { error: "Failed to create product in database." },
      { status: 500 }
    );
  }
}
