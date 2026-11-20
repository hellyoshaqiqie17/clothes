import { NextResponse } from "next/server";
import {
  addNewsletterSubscriber,
  deleteNewsletterSubscriber,
  listNewsletterSubscribers,
} from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const subscribers = await listNewsletterSubscribers();
    return NextResponse.json(
      { subscribers },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/newsletter error:", err);
    return NextResponse.json(
      { error: "Failed to list subscribers." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { email?: string };
    const email = typeof body.email === "string" ? body.email.trim() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Enter a valid email address." },
        { status: 400 }
      );
    }

    const result = await addNewsletterSubscriber(email);
    return NextResponse.json(result, {
      status: result.alreadySubscribed ? 200 : 201,
    });
  } catch (err) {
    console.error("POST /api/newsletter error:", err);
    return NextResponse.json(
      { error: "Failed to save subscription." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { error: "Valid subscriber id is required." },
        { status: 400 }
      );
    }
    const deleted = await deleteNewsletterSubscriber(id);
    if (!deleted) {
      return NextResponse.json(
        { error: "Subscriber not found." },
        { status: 404 }
      );
    }
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    console.error("DELETE /api/newsletter error:", err);
    return NextResponse.json(
      { error: "Failed to remove subscriber." },
      { status: 500 }
    );
  }
}
