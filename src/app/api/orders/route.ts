import { NextResponse } from "next/server";
import {
  createOrder,
  deleteOrder,
  listOrders,
  updateOrderFulfillment,
} from "@/lib/db";
import { getAuthenticatedMemberContext } from "@/lib/memberAuth";
import type { BagItem, CheckoutCustomer, OrderStatus } from "@/types/catalog";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set<OrderStatus>([
  "pending",
  "confirmed",
  "shipped",
  "completed",
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
    const orders = await listOrders();
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

    const memberCtx = await getAuthenticatedMemberContext();
    const order = await createOrder(
      body.items,
      body.customer,
      memberCtx?.member ?? null
    );
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
    const body = (await req.json()) as {
      id?: string;
      status?: OrderStatus;
      isShipped?: boolean;
      isCompleted?: boolean;
      shippingCourier?: string;
      trackingNumber?: string;
    };

    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json(
        { error: "Valid order id is required." },
        { status: 400 }
      );
    }

    if (body.status !== undefined && !VALID_STATUSES.has(body.status)) {
      return NextResponse.json(
        { error: "Invalid order status." },
        { status: 400 }
      );
    }

    const hasUpdate =
      body.status !== undefined ||
      typeof body.isShipped === "boolean" ||
      typeof body.isCompleted === "boolean" ||
      typeof body.shippingCourier === "string" ||
      typeof body.trackingNumber === "string";

    if (!hasUpdate) {
      return NextResponse.json(
        { error: "Provide at least one order field to update." },
        { status: 400 }
      );
    }

    const updated = await updateOrderFulfillment(id, {
      status: body.status,
      isShipped:
        typeof body.isShipped === "boolean" ? body.isShipped : undefined,
      isCompleted:
        typeof body.isCompleted === "boolean" ? body.isCompleted : undefined,
      shippingCourier:
        typeof body.shippingCourier === "string"
          ? body.shippingCourier
          : undefined,
      trackingNumber:
        typeof body.trackingNumber === "string"
          ? body.trackingNumber
          : undefined,
    });
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
    const removed = await deleteOrder(id);
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
