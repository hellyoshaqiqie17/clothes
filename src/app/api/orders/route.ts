import { NextResponse } from "next/server";
import {
  createOrder,
  deleteOrder,
  listOrders,
  updateOrderStatus,
} from "@/lib/db";
import type { BagItem, CheckoutCustomer, OrderStatus } from "@/types/catalog";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<OrderStatus>([
  "pending",
  "confirmed",
  "shipped",
  "cancelled",
]);

function validateCustomer(customer?: CheckoutCustomer): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!customer) return errors;

  if (!customer.name || customer.name.trim().length < 2) {
    errors.name = "Enter your full name (at least 2 characters).";
  }
  if (
    !customer.email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email.trim())
  ) {
    errors.email = "Enter a valid email address for order updates.";
  }
  if (
    !customer.phone ||
    customer.phone.replace(/[^\d+]/g, "").length < 8
  ) {
    errors.phone = "Enter a valid phone or WhatsApp number (min. 8 digits).";
  }
  if (!customer.address || customer.address.trim().length < 8) {
    errors.address = "Enter a complete street shipping address.";
  }
  if (!customer.city || customer.city.trim().length < 2) {
    errors.city = "Enter your city or province.";
  }
  return errors;
}

export async function GET() {
  try {
    const orders = listOrders();
    return NextResponse.json(
      { orders },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("GET /api/orders error:", err);
    return NextResponse.json(
      { error: "Failed to load orders." },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      items?: BagItem[];
      customer?: CheckoutCustomer;
    };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json(
        { error: "Order must include at least one item." },
        { status: 400 }
      );
    }

    if (!body.customer) {
      return NextResponse.json(
        { error: "Shipping contact details are required to place an order." },
        { status: 400 }
      );
    }

    const fieldErrors = validateCustomer(body.customer);
    if (Object.keys(fieldErrors).length > 0) {
      return NextResponse.json(
        {
          error: "Please fix the highlighted shipping details before submitting.",
          fieldErrors,
        },
        { status: 400 }
      );
    }

    const order = createOrder(body.items, body.customer);
    return NextResponse.json({ order }, { status: 201 });
  } catch (err) {
    console.error("POST /api/orders error:", err);
    const message =
      err instanceof Error ? err.message : "Failed to record order.";
    const status = message.includes("no longer available") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as { id?: string; status?: OrderStatus };
    if (!body.id || !body.status || !VALID_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: "Valid order id and status are required." },
        { status: 400 }
      );
    }
    const updated = updateOrderStatus(body.id, body.status);
    if (!updated) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    return NextResponse.json({ order: updated });
  } catch (err) {
    console.error("PATCH /api/orders error:", err);
    return NextResponse.json(
      { error: "Failed to update order status." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id")?.trim();
    if (!id) {
      return NextResponse.json(
        { error: "Order id is required." },
        { status: 400 }
      );
    }
    const removed = deleteOrder(id);
    if (!removed) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }
    return NextResponse.json({ deleted: true, id });
  } catch (err) {
    console.error("DELETE /api/orders error:", err);
    return NextResponse.json(
      { error: "Failed to delete order." },
      { status: 500 }
    );
  }
}
