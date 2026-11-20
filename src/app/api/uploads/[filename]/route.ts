import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { UPLOADS_DIR } from "@/lib/db";

export const dynamic = "force-dynamic";

const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/;
const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export async function GET(
  _req: Request,
  context: { params: Promise<{ filename: string }> }
) {
  try {
    const { filename } = await context.params;
    if (!SAFE_FILENAME.test(filename)) {
      return NextResponse.json({ error: "Invalid filename." }, { status: 400 });
    }

    const filePath = path.join(UPLOADS_DIR, filename);
    const data = await fs.readFile(filePath);
    const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
    const mime = EXT_TO_MIME[ext] ?? "application/octet-stream";

    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "Image not found." }, { status: 404 });
  }
}
