import { NextResponse } from "next/server";
import { getObject } from "@/lib/r2";

export const dynamic = "force-dynamic";

const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/;

export async function GET(
  _req: Request,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await context.params;
    if (!SAFE_FILENAME.test(filename)) {
      return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
    }

    const obj = await getObject(`uploads/${filename}`);
    if (!obj) {
      return NextResponse.json({ error: "Image not found." }, { status: 404 });
    }

    return new NextResponse(Buffer.from(obj.body), {
      status: 200,
      headers: {
        "Content-Type": obj.contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("GET /api/uploads/[filename] error:", err);
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
}
