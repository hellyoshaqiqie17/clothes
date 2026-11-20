import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { putObject } from "@/lib/r2";

export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024; // Vercel serverless request body limit is ~4.5 MB
const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Missing image file field." },
        { status: 400 }
      );
    }

    const ext = MIME_TO_EXT[file.type.toLowerCase()];
    if (!ext) {
      return NextResponse.json(
        { error: "Only PNG, JPG, and WebP images are supported." },
        { status: 400 }
      );
    }

    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { error: "Image must be between 1 byte and 4 MB." },
        { status: 400 }
      );
    }

    const filename = `garment-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    await putObject(`uploads/${filename}`, buffer, file.type.toLowerCase());

    return NextResponse.json(
      { url: `/api/uploads/${filename}`, filename },
      { status: 201 }
    );
  } catch (err) {
    console.error("POST /api/uploads error:", err);
    return NextResponse.json(
      { error: "Failed to upload garment image." },
      { status: 500 }
    );
  }
}
