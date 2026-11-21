import { NextResponse } from "next/server";
import {
  BinderPayApiError,
  BinderPayConfigError,
  formatPaymentMethodDisplay,
  isValidPaymentSelection,
  resolveSiteOrigin,
} from "@/lib/binderpay";
import {
  attachPaymentToExistingOrder,
  createOrderWithPayment,
  getOrderById,
  prepareOrderQuote,
} from "@/lib/db";
import {
  cancelGatewayPaymentBestEffort,
  createGatewayPaymentForOrder,
} from "@/lib/paymentService";
import type { BagItem, CheckoutCustomer } from "@/types/catalog";

export const dynamic = "force-dynamic";

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

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      orderId?: string;
      items?: BagItem[];
      customer?: CheckoutCustomer;
      paymentType?: string;
      channel?: string;
    };

    const selection = isValidPaymentSelection(
      body.paymentType || "",
      body.channel || ""
    );
    if (!selection) {
      return NextResponse.json(
        {
          error:
            "Metode pembayaran tidak valid. Pilih QRIS, Virtual Account, atau Payment Link.",
        },
        { status: 400 }
      );
    }

    const siteOrigin = resolveSiteOrigin(req);
    const paymentMethodLabel = formatPaymentMethodDisplay(
      selection.paymentType,
      selection.channel
    );

    // Path A: Switching / regenerating payment for an existing unpaid order
    if (body.orderId?.trim()) {
      const existingOrder = await getOrderById(body.orderId);
      if (!existingOrder) {
        return NextResponse.json(
          { error: "Order tidak ditemukan." },
          { status: 404 }
        );
      }
      if (
        existingOrder.status === "confirmed" ||
        existingOrder.status === "shipped" ||
        existingOrder.payment?.status === "paid"
      ) {
        return NextResponse.json(
          { error: "Pesanan ini sudah lunas dan tidak perlu pembayaran ulang." },
          { status: 409 }
        );
      }

      if (existingOrder.payment && existingOrder.payment.status === "pending") {
        await cancelGatewayPaymentBestEffort(
          existingOrder.payment,
          "Customer switched payment method"
        );
      }

      const itemSummary = existingOrder.items
        .map((i) => `${i.quantity}x ${i.title}`)
        .join(", ");

      const created = await createGatewayPaymentForOrder({
        orderId: existingOrder.id,
        amount: existingOrder.total,
        itemCount: existingOrder.itemCount,
        itemSummary,
        customer: {
          name: existingOrder.customerName || "Customer",
          email: existingOrder.customerEmail || "customer@meridian.id",
          phone: existingOrder.customerPhone || "081200000000",
          address: existingOrder.shippingAddress,
          city: existingOrder.shippingCity,
          notes: existingOrder.notes,
        },
        paymentType: selection.paymentType,
        channel: selection.channel,
        siteOrigin,
      });

      try {
        const persisted = await attachPaymentToExistingOrder({
          orderId: existingOrder.id,
          paymentMethodLabel,
          payment: created.record,
        });
        return NextResponse.json(persisted, { status: 201 });
      } catch (dbErr) {
        await created.rollback();
        throw dbErr;
      }
    }

    // Path B: New order + BinderPay payment transaction (atomic: zero orphan orders if BinderPay rejects)
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

    const quote = await prepareOrderQuote(body.items);
    const itemSummary = quote.verifiedItems
      .map((i) => `${i.quantity}x ${i.title}`)
      .join(", ");

    const created = await createGatewayPaymentForOrder({
      orderId: quote.id,
      amount: quote.total,
      itemCount: quote.itemCount,
      itemSummary,
      customer: body.customer,
      paymentType: selection.paymentType,
      channel: selection.channel,
      siteOrigin,
    });

    try {
      const persisted = await createOrderWithPayment({
        quote,
        customer: body.customer,
        paymentMethodLabel,
        payment: created.record,
      });
      return NextResponse.json(persisted, { status: 201 });
    } catch (dbErr) {
      await created.rollback();
      throw dbErr;
    }
  } catch (err) {
    console.error("POST /api/payments/binderpay/create error:", err);
    if (err instanceof BinderPayConfigError) {
      return NextResponse.json(
        {
          error: err.message,
          code: "BINDERPAY_NOT_CONFIGURED",
          missingEnvVars: err.missingEnvVars,
        },
        { status: 503 }
      );
    }
    if (err instanceof BinderPayApiError) {
      return NextResponse.json(
        {
          error: err.message,
          code: err.responseCode || "BINDERPAY_API_ERROR",
        },
        { status: err.status && err.status >= 400 && err.status < 500 ? err.status : 502 }
      );
    }
    const message =
      err instanceof Error ? err.message : "Failed to create payment.";
    const status = message.includes("no longer available") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
