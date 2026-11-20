import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const MODEL_PATH = path.join(
  process.cwd(),
  "public",
  "models",
  "garment-only.glb"
);

export async function GET() {
  try {
    const data = await fs.readFile(MODEL_PATH);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (err) {
    console.error("GET /api/models/garment error:", err);
    return NextResponse.json(
      { error: "Garment 3D model file is missing on server." },
      { status: 404 }
    );
  }
}
