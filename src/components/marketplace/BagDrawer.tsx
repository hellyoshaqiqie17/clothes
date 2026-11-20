"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatIDR } from "@/data/catalogProducts";
import type { BagItem, CheckoutCustomer, StoreOrder } from "@/types/catalog";

interface BagDrawerProps {
  open: boolean;
  items: BagItem[];
  freeShippingThreshold: number;
  standardShippingFee: number;
  onUpdateQty: (key: string, delta: number) => void;
  onRemoveItem: (key: string) => void;
  onSubmitOrder: (
    items: BagItem[],
    customer: CheckoutCustomer
  ) => Promise<{
    order: StoreOrder | null;
    error?: string;
    fieldErrors?: Record<string, string>;
  }>;
  onTrackOrder: (orderId: string) => void;
  onClear: () => void;
  onClose: () => void;
}

const EMPTY_CUSTOMER: CheckoutCustomer = {
  name: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  notes: "",
};

function validateField(
  field: keyof CheckoutCustomer,
  value: string
): string | null {
  const trimmed = value.trim();
  if (field === "name" && trimmed.length < 2) {
    return "Enter your full name (at least 2 characters).";
  }
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return "Enter a valid email address for order confirmation.";
  }
  if (field === "phone" && trimmed.replace(/[^\d+]/g, "").length < 8) {
    return "Enter a valid phone or WhatsApp number (min. 8 digits).";
  }
  if (field === "address" && trimmed.length < 8) {
    return "Enter your complete street address.";
  }
  if (field === "city" && trimmed.length < 2) {
    return "Enter your city or province.";
  }
  return null;
}

export default function BagDrawer({
  open,
  items,
  freeShippingThreshold,
  standardShippingFee,
  onUpdateQty,
  onRemoveItem,
  onSubmitOrder,
  onTrackOrder,
  onClear,
  onClose,
}: BagDrawerProps) {
  const [step, setStep] = useState<"bag" | "checkout" | "receipt">("bag");
  const [customer, setCustomer] = useState<CheckoutCustomer>(EMPTY_CUSTOMER);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [placedOrder, setPlacedOrder] = useState<StoreOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const errorSummaryRef = useRef<HTMLDivElement | null>(null);

  const handleClose = useCallback(() => {
    setStep("bag");
    setPlacedOrder(null);
    setSubmitError(null);
    setFieldErrors({});
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  if (!open) return null;

  const totalCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const shippingFee =
    subtotal >= freeShippingThreshold || items.length === 0
      ? 0
      : standardShippingFee;
  const grandTotal = subtotal + shippingFee;
  const remainingForFreeShipping = Math.max(0, freeShippingThreshold - subtotal);
  const shippingProgress =
    freeShippingThreshold > 0
      ? Math.min(100, Math.round((subtotal / freeShippingThreshold) * 100))
      : 100;

  const handleFieldBlur = (field: keyof CheckoutCustomer) => {
    const err = validateField(field, customer[field] ?? "");
    setFieldErrors((prev) => {
      const next = { ...prev };
      if (err) next[field] = err;
      else delete next[field];
      return next;
    });
  };

  const handleFieldChange = (field: keyof CheckoutCustomer, value: string) => {
    setCustomer((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      const err = validateField(field, value);
      setFieldErrors((prev) => {
        const next = { ...prev };
        if (err) next[field] = err;
        else delete next[field];
        return next;
      });
    }
  };

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const requiredFields: (keyof CheckoutCustomer)[] = [
      "name",
      "email",
      "phone",
      "address",
      "city",
    ];
    const nextErrors: Record<string, string> = {};
    for (const f of requiredFields) {
      const err = validateField(f, customer[f] ?? "");
      if (err) nextErrors[f] = err;
    }

    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setSubmitError("Please fix the highlighted fields to complete your order.");
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    setFieldErrors({});
    try {
      const res = await onSubmitOrder(items, customer);
      if (res.order) {
        setPlacedOrder(res.order);
        setStep("receipt");
        setCustomer(EMPTY_CUSTOMER);
        onClear();
      } else {
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        setSubmitError(
          res.error || "Could not submit your order. Please try again."
        );
        window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      }
    } catch {
      setSubmitError("Network error while placing your order. Please try again.");
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    } finally {
      setSubmitting(false);
    }
  };

  const fieldErrorEntries = Object.entries(fieldErrors);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/55"
      role="dialog"
      aria-modal="true"
      aria-labelledby="market-bag-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="flex h-full w-full max-w-md flex-col bg-white text-[#181817] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E3DC] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            {step === "checkout" && (
              <button
                type="button"
                onClick={() => {
                  setStep("bag");
                  setSubmitError(null);
                }}
                aria-label="Back to shopping bag"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] text-sm text-[#181817] hover:bg-[#F5F5F5]"
              >
                ←
              </button>
            )}
            <h2
              id="market-bag-title"
              className="font-display text-xl font-medium tracking-tight text-[#181817]"
            >
              {step === "receipt"
                ? "Order Confirmed"
                : step === "checkout"
                ? "Shipping Details"
                : "Your Bag"}
            </h2>
            {step === "bag" && (
              <span className="inline-flex h-5 min-w-[20px] items-center justify-center bg-[#181817] px-1.5 text-[11px] font-semibold tabular-nums text-white">
                {totalCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close shopping bag"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] text-base font-medium text-[#181817] hover:bg-[#F5F5F5]"
          >
            ×
          </button>
        </div>

        {/* Free Shipping Bar (Bag Step) */}
        {step === "bag" && items.length > 0 && (
          <div className="border-b border-[#E5E3DC] bg-[#FAFAFA] px-5 py-3 text-xs text-[#57534E] sm:px-6">
            <div className="flex items-center justify-between gap-2">
              {remainingForFreeShipping === 0 ? (
                <span className="font-medium text-[#181817]">
                  Free insured shipping unlocked.
                </span>
              ) : (
                <span>
                  Add{" "}
                  <strong className="font-semibold tabular-nums text-[#181817]">
                    {formatIDR(remainingForFreeShipping)}
                  </strong>{" "}
                  more for free shipping.
                </span>
              )}
              <span className="tabular-nums text-[11px] text-[#57534E]">
                {shippingProgress}%
              </span>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden bg-[#E5E3DC]">
              <div
                className="h-full bg-[#181817] transition-all duration-300"
                style={{ width: `${shippingProgress}%` }}
              />
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
          {step === "receipt" && placedOrder ? (
            <div className="space-y-4 border border-[#181817] bg-[#FAFAFA] p-5 text-sm text-[#181817]">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#881337]">
                Order Reference · {placedOrder.id}
              </p>
              <p className="font-display text-2xl font-normal">
                Thank you, {placedOrder.customerName || "Customer"}
              </p>
              <p className="text-xs leading-relaxed text-[#57534E]">
                Your order for {placedOrder.itemCount} item(s) totaling{" "}
                <strong className="font-semibold tabular-nums text-[#181817]">
                  {formatIDR(placedOrder.total)}
                </strong>{" "}
                has been recorded. Our team will confirm shipping details via{" "}
                <strong className="font-medium text-[#181817]">
                  {placedOrder.customerPhone || placedOrder.customerEmail}
                </strong>
                .
              </p>

              <div className="space-y-1 border-t border-[#E5E3DC] pt-3 text-xs">
                <p className="font-semibold text-[#181817]">Deliver To</p>
                <p className="text-[#57534E]">
                  {placedOrder.shippingAddress}, {placedOrder.shippingCity}
                </p>
                <p className="text-[11px] text-[#57534E]">
                  Payment: {placedOrder.paymentMethod}
                </p>
              </div>

              <div className="flex flex-col gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const id = placedOrder.id;
                    handleClose();
                    onTrackOrder(id);
                  }}
                  className="min-h-[44px] w-full bg-[#181817] px-4 py-2 text-xs font-medium text-white hover:bg-[#333330]"
                >
                  Track Order Status
                </button>
                <button
                  type="button"
                  onClick={handleClose}
                  className="min-h-[44px] w-full border border-[#181817] bg-white px-4 py-2 text-xs font-medium text-[#181817] hover:bg-[#F5F5F5]"
                >
                  Continue Shopping
                </button>
              </div>
            </div>
          ) : step === "checkout" ? (
            <form
              id="meridian-checkout-form"
              onSubmit={(e) => void handleCheckoutSubmit(e)}
              noValidate
              className="space-y-4"
            >
              {(submitError || fieldErrorEntries.length > 0) && (
                <div
                  ref={errorSummaryRef}
                  tabIndex={-1}
                  role="alert"
                  className="border border-[#881337] bg-[#FFF1F2] p-3.5 text-xs text-[#881337]"
                >
                  <p className="font-semibold">
                    {submitError || "Please check the fields below"}
                  </p>
                  {fieldErrorEntries.length > 0 && (
                    <ul className="mt-1.5 list-disc space-y-1 pl-4">
                      {fieldErrorEntries.map(([key, msg]) => (
                        <li key={key}>
                          <a
                            href={`#checkout-${key}`}
                            className="underline hover:no-underline"
                          >
                            {msg}
                          </a>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div>
                <label
                  htmlFor="checkout-name"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Full Name *
                </label>
                <input
                  id="checkout-name"
                  type="text"
                  autoComplete="name"
                  required
                  value={customer.name}
                  onChange={(e) => handleFieldChange("name", e.target.value)}
                  onBlur={() => handleFieldBlur("name")}
                  aria-invalid={Boolean(fieldErrors.name)}
                  aria-describedby={fieldErrors.name ? "err-name" : undefined}
                  placeholder="Raka Pratama"
                  className={`mt-1 min-h-[44px] w-full border bg-white px-3 text-xs text-[#181817] ${
                    fieldErrors.name ? "border-[#881337]" : "border-[#E5E3DC]"
                  }`}
                />
                {fieldErrors.name && (
                  <p id="err-name" className="mt-1 text-[11px] text-[#881337]">
                    {fieldErrors.name}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="checkout-email"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Email *
                  </label>
                  <input
                    id="checkout-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={customer.email}
                    onChange={(e) => handleFieldChange("email", e.target.value)}
                    onBlur={() => handleFieldBlur("email")}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? "err-email" : undefined}
                    placeholder="you@domain.com"
                    className={`mt-1 min-h-[44px] w-full border bg-white px-3 text-xs text-[#181817] ${
                      fieldErrors.email ? "border-[#881337]" : "border-[#E5E3DC]"
                    }`}
                  />
                  {fieldErrors.email && (
                    <p id="err-email" className="mt-1 text-[11px] text-[#881337]">
                      {fieldErrors.email}
                    </p>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="checkout-phone"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Phone / WhatsApp *
                  </label>
                  <input
                    id="checkout-phone"
                    type="tel"
                    autoComplete="tel"
                    required
                    value={customer.phone}
                    onChange={(e) => handleFieldChange("phone", e.target.value)}
                    onBlur={() => handleFieldBlur("phone")}
                    aria-invalid={Boolean(fieldErrors.phone)}
                    aria-describedby={fieldErrors.phone ? "err-phone" : undefined}
                    placeholder="0812 3456 7890"
                    className={`mt-1 min-h-[44px] w-full border bg-white px-3 text-xs text-[#181817] ${
                      fieldErrors.phone ? "border-[#881337]" : "border-[#E5E3DC]"
                    }`}
                  />
                  {fieldErrors.phone && (
                    <p id="err-phone" className="mt-1 text-[11px] text-[#881337]">
                      {fieldErrors.phone}
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label
                  htmlFor="checkout-address"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Street Address *
                </label>
                <textarea
                  id="checkout-address"
                  rows={2}
                  autoComplete="street-address"
                  required
                  value={customer.address}
                  onChange={(e) => handleFieldChange("address", e.target.value)}
                  onBlur={() => handleFieldBlur("address")}
                  aria-invalid={Boolean(fieldErrors.address)}
                  aria-describedby={fieldErrors.address ? "err-address" : undefined}
                  placeholder="Jl. Kemang Raya No. 18, Jakarta Selatan"
                  className={`mt-1 w-full border bg-white p-3 text-xs text-[#181817] ${
                    fieldErrors.address ? "border-[#881337]" : "border-[#E5E3DC]"
                  }`}
                />
                {fieldErrors.address && (
                  <p id="err-address" className="mt-1 text-[11px] text-[#881337]">
                    {fieldErrors.address}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="checkout-city"
                  className="block text-xs font-medium text-[#181817]"
                >
                  City / Province *
                </label>
                <input
                  id="checkout-city"
                  type="text"
                  autoComplete="address-level2"
                  required
                  value={customer.city}
                  onChange={(e) => handleFieldChange("city", e.target.value)}
                  onBlur={() => handleFieldBlur("city")}
                  aria-invalid={Boolean(fieldErrors.city)}
                  aria-describedby={fieldErrors.city ? "err-city" : undefined}
                  placeholder="Jakarta Selatan"
                  className={`mt-1 min-h-[44px] w-full border bg-white px-3 text-xs text-[#181817] ${
                    fieldErrors.city ? "border-[#881337]" : "border-[#E5E3DC]"
                  }`}
                />
                {fieldErrors.city && (
                  <p id="err-city" className="mt-1 text-[11px] text-[#881337]">
                    {fieldErrors.city}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="checkout-notes"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Delivery Notes (optional)
                </label>
                <input
                  id="checkout-notes"
                  type="text"
                  value={customer.notes ?? ""}
                  onChange={(e) => handleFieldChange("notes", e.target.value)}
                  placeholder="Leave with reception or preferred delivery hours"
                  className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                />
              </div>

              <div className="border border-[#E5E3DC] bg-[#FAFAFA] p-3.5 text-xs text-[#57534E]">
                <p className="font-semibold text-[#181817]">
                  Payment &amp; Confirmation
                </p>
                <p className="mt-1 leading-relaxed">
                  Online payment gateway is not enabled yet. Submitting this form
                  reserves your order for manual confirmation (Bank Transfer or Pay on
                  Delivery).
                </p>
              </div>
            </form>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-semibold text-[#181817]">Your bag is empty</p>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[#57534E]">
                Browse the collection to inspect any piece in photos or 3D, pick your
                size, and add it here.
              </p>
              <button
                type="button"
                onClick={handleClose}
                className="mt-5 min-h-[44px] bg-[#181817] px-5 text-xs font-medium text-white hover:bg-[#333330]"
              >
                Continue Shopping
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[#E5E3DC]">
              {items.map((item) => (
                <li key={item.key} className="flex gap-3.5 py-4">
                  <div className="h-20 w-20 shrink-0 overflow-hidden border border-[#E5E3DC] bg-[#EFEFEB]">
                    {item.thumbnailUrl ? (
                      <Image
                        src={item.thumbnailUrl}
                        alt={item.title}
                        width={80}
                        height={80}
                        unoptimized
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-[11px] text-[#57534E]">
                        3D
                      </div>
                    )}
                  </div>

                  <div className="flex min-w-0 flex-1 flex-col justify-between">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#57534E]">
                          {item.brand}
                        </p>
                        <p className="truncate text-sm font-semibold text-[#181817]">
                          {item.title}
                        </p>
                        <p className="mt-0.5 text-xs capitalize text-[#57534E]">
                          Size {item.size} · {item.colorTag.toLowerCase()}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onRemoveItem(item.key)}
                        aria-label={`Remove ${item.title} size ${item.size} from bag`}
                        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-[#57534E] hover:text-[#881337]"
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          aria-hidden="true"
                        >
                          <path d="M3 6h18" />
                          <path d="M8 6V4h8v2" />
                          <path d="M6 6l1 14h10l1-14" />
                        </svg>
                      </button>
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2">
                      <div className="flex items-center border border-[#E5E3DC]">
                        <button
                          type="button"
                          aria-label={`Decrease quantity for ${item.title}`}
                          onClick={() => onUpdateQty(item.key, -1)}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-sm text-[#181817] hover:bg-[#F5F5F5]"
                        >
                          -
                        </button>
                        <span className="min-w-[28px] text-center text-xs font-medium tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          aria-label={`Increase quantity for ${item.title}`}
                          onClick={() => onUpdateQty(item.key, 1)}
                          className="flex min-h-[44px] min-w-[44px] items-center justify-center text-sm text-[#181817] hover:bg-[#F5F5F5]"
                        >
                          +
                        </button>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-[#181817]">
                        {formatIDR(item.price * item.quantity)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Sticky Footer Totals & CTA */}
        {items.length > 0 && step !== "receipt" && (
          <div className="border-t border-[#E5E3DC] bg-[#FAFAFA] px-5 py-4 sm:px-6">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-[#57534E]">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatIDR(subtotal)}</span>
              </div>
              <div className="flex justify-between text-[#57534E]">
                <span>Shipping</span>
                <span className="tabular-nums">
                  {shippingFee === 0 ? "Free" : formatIDR(shippingFee)}
                </span>
              </div>
              <div className="flex items-baseline justify-between border-t border-[#E5E3DC] pt-2 text-sm font-semibold text-[#181817]">
                <span>Total</span>
                <span className="tabular-nums">{formatIDR(grandTotal)}</span>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              {step === "bag" ? (
                <>
                  <button
                    type="button"
                    onClick={() => setStep("checkout")}
                    className="min-h-[48px] w-full bg-[#181817] px-4 py-3 text-xs font-medium tracking-wide text-white transition-colors hover:bg-[#333330]"
                  >
                    Proceed to Checkout
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="min-h-[44px] w-full border border-[#181817] bg-white px-4 py-2 text-xs font-medium tracking-wide text-[#181817] transition-colors hover:bg-[#F5F5F5]"
                  >
                    Continue Shopping
                  </button>
                </>
              ) : (
                <button
                  type="submit"
                  form="meridian-checkout-form"
                  disabled={submitting}
                  className="min-h-[48px] w-full bg-[#181817] px-4 py-3 text-xs font-medium tracking-wide tabular-nums text-white transition-colors hover:bg-[#333330] disabled:opacity-60"
                >
                  {submitting
                    ? "Recording Order..."
                    : `Confirm Order · ${formatIDR(grandTotal)}`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
