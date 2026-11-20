import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { UPLOADS_DIR } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
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
        { error: "Image must be between 1 byte and 12 MB." },
        { status: 400 }
      );
    }

    await fs.mkdir(UPLOADS_DIR, { recursive: true });
    const filename = `garment-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")}.${ext}`;
    const targetPath = path.join(UPLOADS_DIR, filename);
    const buffer = Buffer.from(await file.arrayBuffer());
    await fs.writeFile(targetPath, buffer);

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
