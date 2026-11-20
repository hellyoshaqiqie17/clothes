import { NextResponse } from "next/server";
import { listHeroSlides, replaceHeroSlides } from "@/lib/db";
import type { HeroSlide } from "@/types/catalog";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const heroSlides = listHeroSlides();
    return NextResponse.json(
      { heroSlides },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/hero-slides error:", err);
    return NextResponse.json(
      { error: "Failed to load hero slides." },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as { heroSlides?: HeroSlide[] };
    if (!Array.isArray(body.heroSlides) || body.heroSlides.length === 0) {
      return NextResponse.json(
        { error: "At least one hero slide is required." },
        { status: 400 }
      );
    }

    const sanitized: HeroSlide[] = body.heroSlides.map((s, idx) => ({
      id: String(s.id || `slide-${idx + 1}`),
      productId: String(s.productId),
      headlineStart: String(s.headlineStart ?? ""),
      headlineItalic: String(s.headlineItalic ?? ""),
      headlineEnd: String(s.headlineEnd ?? ""),
      subtitle: String(s.subtitle ?? ""),
      ctaLabel: String(s.ctaLabel ?? "View Piece"),
      sortOrder: idx + 1,
    }));

    const saved = replaceHeroSlides(sanitized);
    return NextResponse.json({ heroSlides: saved });
  } catch (err) {
    console.error("PUT /api/hero-slides error:", err);
    const msg =
      err instanceof Error ? err.message : "Failed to save hero slides.";
    return NextResponse.json(
      { error: msg },
      { status: msg.includes("existing product") ? 400 : 500 }
    );
  }
}
