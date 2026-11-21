"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatIDR } from "@/data/catalogProducts";
import BinderPayPaymentPanel from "@/components/marketplace/BinderPayPaymentPanel";
import type {
  BagItem,
  BinderPayChannelOption,
  BinderPayConfigStatus,
  CheckoutCustomer,
  CheckoutPaymentSelection,
  CheckoutPricingQuote,
  MemberProfile,
  StoreOrder,
  StoreSettings,
} from "@/types/catalog";

interface BagDrawerProps {
  open: boolean;
  items: BagItem[];
  member: MemberProfile | null;
  settings: StoreSettings;
  freeShippingThreshold: number;
  standardShippingFee: number;
  onUpdateQty: (key: string, delta: number) => void;
  onRemoveItem: (key: string) => void;
  onOpenAccount: (mode: "login" | "register") => void;
  onSubmitOrder: (
    items: BagItem[],
    customer: CheckoutCustomer,
    payment: CheckoutPaymentSelection,
    voucherCode?: string
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

const FALLBACK_CHANNELS: BinderPayChannelOption[] = [
  {
    paymentType: "qris",
    channel: "QRIS",
    label: "QRIS (GoPay, OVO, DANA, ShopeePay, Mobile Banking)",
    shortLabel: "QRIS",
    group: "instant",
    description: "Scan instantly from any Indonesian e-wallet or mobile banking app.",
  },
  {
    paymentType: "va",
    channel: "BCA",
    label: "BCA Virtual Account",
    shortLabel: "BCA VA",
    group: "va",
    description: "m-BCA, myBCA, KlikBCA, or ATM BCA",
  },
  {
    paymentType: "va",
    channel: "MANDIRI",
    label: "Mandiri Virtual Account",
    shortLabel: "Mandiri VA",
    group: "va",
    description: "Livin' by Mandiri or ATM Mandiri",
  },
  {
    paymentType: "va",
    channel: "BNI",
    label: "BNI Virtual Account",
    shortLabel: "BNI VA",
    group: "va",
    description: "wondr / BNI Mobile Banking or ATM BNI",
  },
  {
    paymentType: "va",
    channel: "BRI",
    label: "BRI Virtual Account",
    shortLabel: "BRI VA",
    group: "va",
    description: "BRImo or ATM BRI",
  },
  {
    paymentType: "payment_link",
    channel: "LINK",
    label: "BinderPay Hosted Checkout",
    shortLabel: "Payment Link",
    group: "hosted",
    description: "Choose QRIS or any Virtual Account on BinderPay's hosted checkout.",
  },
];

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
  member,
  settings,
  freeShippingThreshold,
  standardShippingFee,
  onUpdateQty,
  onRemoveItem,
  onOpenAccount,
  onSubmitOrder,
  onTrackOrder,
  onClear,
  onClose,
}: BagDrawerProps) {
  const [step, setStep] = useState<"bag" | "checkout" | "payment" | "receipt">(
    "bag"
  );
  const [customer, setCustomer] = useState<CheckoutCustomer>(EMPTY_CUSTOMER);
  const [selectedPayment, setSelectedPayment] =
    useState<CheckoutPaymentSelection>({
      paymentType: "qris",
      channel: "QRIS",
    });
  const [voucherInput, setVoucherInput] = useState("");
  const [appliedVoucherCode, setAppliedVoucherCode] = useState("");
  const [quote, setQuote] = useState<CheckoutPricingQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [gatewayConfig, setGatewayConfig] =
    useState<BinderPayConfigStatus | null>(null);
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

  // Auto-fill shipping form from logged-in member profile whenever blank
  useEffect(() => {
    if (!open || !member) return;
    const timer = window.setTimeout(() => {
      setCustomer((prev) => ({
        name: prev.name || member.name || "",
        email: prev.email || member.email || "",
        phone: prev.phone || member.phone || "",
        address: prev.address || member.defaultAddress || "",
        city: prev.city || member.defaultCity || "",
        notes: prev.notes || "",
      }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, member]);

  // Live server-side authoritative quote (member discount + voucher + shipping)
  const fetchQuote = useCallback(
    async (bagList: BagItem[], codeToCheck: string) => {
      if (bagList.length === 0) {
        setQuote(null);
        return;
      }
      setQuoteLoading(true);
      try {
        const res = await fetch("/api/checkout/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: bagList,
            voucherCode: codeToCheck || undefined,
          }),
        });
        const data = (await res.json()) as { pricing?: CheckoutPricingQuote };
        if (res.ok && data.pricing) {
          setQuote(data.pricing);
        }
      } catch {
        // non-blocking fallback to local subtotal
      } finally {
        setQuoteLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!open || items.length === 0) return;
    const timer = window.setTimeout(() => {
      void fetchQuote(items, appliedVoucherCode);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, items, member?.id, member?.orderCount, appliedVoucherCode, fetchQuote]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, handleClose]);

  // Load BinderPay gateway configuration & enabled channels when drawer opens
  useEffect(() => {
    if (!open) return;
    let active = true;
    fetch("/api/payments/binderpay/config", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as BinderPayConfigStatus;
        if (!active) return;
        setGatewayConfig(data);
        if (data.channels.length > 0) {
          setSelectedPayment((cur) => {
            const exists = data.channels.some(
              (c) =>
                c.paymentType === cur.paymentType && c.channel === cur.channel
            );
            return exists
              ? cur
              : {
                  paymentType: data.channels[0].paymentType,
                  channel: data.channels[0].channel,
                };
          });
        }
      })
      .catch(() => {
        // fall back cleanly to default channel list
      });
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  const channels =
    gatewayConfig && gatewayConfig.channels.length > 0
      ? gatewayConfig.channels
      : FALLBACK_CHANNELS;
  const instantChannels = channels.filter((c) => c.group === "instant");
  const vaChannels = channels.filter((c) => c.group === "va");
  const hostedChannels = channels.filter((c) => c.group === "hosted");

  const totalCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const rawSubtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const subtotal = quote?.subtotal ?? rawSubtotal;
  const memberDiscount = quote?.memberDiscount ?? 0;
  const voucherDiscount = quote?.voucherDiscount ?? 0;
  const discountTotal = quote?.discountTotal ?? memberDiscount + voucherDiscount;
  const netSubtotal = Math.max(0, subtotal - discountTotal);
  const shippingFee =
    quote?.shippingFee ??
    (netSubtotal >= freeShippingThreshold || items.length === 0
      ? 0
      : standardShippingFee);
  const grandTotal = quote?.total ?? netSubtotal + shippingFee;
  const remainingForFreeShipping = Math.max(
    0,
    freeShippingThreshold - netSubtotal
  );
  const shippingProgress =
    freeShippingThreshold > 0
      ? Math.min(100, Math.round((netSubtotal / freeShippingThreshold) * 100))
      : 100;

  const selectedChannelMeta = channels.find(
    (c) =>
      c.paymentType === selectedPayment.paymentType &&
      c.channel === selectedPayment.channel
  );

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
      const codeToUse =
        quote?.voucherValid && quote.voucherCode
          ? quote.voucherCode
          : appliedVoucherCode.trim() || undefined;
      const res = await onSubmitOrder(
        items,
        customer,
        selectedPayment,
        codeToUse
      );
      if (res.order) {
        setPlacedOrder(res.order);
        setStep(res.order.payment?.status === "paid" ? "receipt" : "payment");
        setCustomer(EMPTY_CUSTOMER);
        setVoucherInput("");
        setAppliedVoucherCode("");
        setQuote(null);
        onClear();
      } else {
        if (res.fieldErrors) setFieldErrors(res.fieldErrors);
        setSubmitError(
          res.error || "Could not create your BinderPay payment. Please try again."
        );
        window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
      }
    } catch {
      setSubmitError("Network error while creating payment. Please try again.");
      window.setTimeout(() => errorSummaryRef.current?.focus(), 0);
    } finally {
      setSubmitting(false);
    }
  };

  const handleOrderUpdatedFromPanel = (updated: StoreOrder) => {
    setPlacedOrder(updated);
    if (updated.payment?.status === "paid") {
      setStep("receipt");
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
                ? "Payment Confirmed"
                : step === "payment"
                ? "Complete Payment"
                : step === "checkout"
                ? "Checkout & Payment"
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
          {(step === "payment" || step === "receipt") && placedOrder ? (
            <div className="space-y-4">
              {placedOrder.payment ? (
                <BinderPayPaymentPanel
                  order={placedOrder}
                  payment={placedOrder.payment}
                  availableChannels={channels}
                  onOrderUpdated={handleOrderUpdatedFromPanel}
                  onTrackOrder={(orderId) => {
                    handleClose();
                    onTrackOrder(orderId);
                  }}
                />
              ) : (
                <div className="space-y-3 border border-[#181817] bg-[#FAFAFA] p-5 text-xs">
                  <p className="font-semibold uppercase tracking-[0.12em] text-[#881337]">
                    Order Reference · {placedOrder.id}
                  </p>
                  <p className="font-display text-2xl font-normal">
                    Thank you, {placedOrder.customerName || "Customer"}
                  </p>
                </div>
              )}

              <div className="space-y-1.5 border border-[#E5E3DC] bg-[#FAFAFA] p-4 text-xs">
                <p className="font-semibold text-[#181817]">Shipping Summary</p>
                <p className="text-[#181817]">
                  {placedOrder.customerName} · {placedOrder.customerPhone}
                </p>
                <p className="text-[#57534E]">
                  {placedOrder.shippingAddress}, {placedOrder.shippingCity}
                </p>
                <p className="pt-1 text-[11px] text-[#57534E]">
                  Simpan kode pesanan{" "}
                  <strong className="font-mono font-semibold text-[#181817]">
                    {placedOrder.id}
                  </strong>{" "}
                  untuk melacak atau melanjutkan pembayaran kapan saja di menu
                  Track Order.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                {step !== "receipt" && (
                  <button
                    type="button"
                    onClick={() => {
                      const id = placedOrder.id;
                      handleClose();
                      onTrackOrder(id);
                    }}
                    className="min-h-[44px] w-full border border-[#181817] bg-white px-4 py-2 text-xs font-medium text-[#181817] hover:bg-[#F5F5F5]"
                  >
                    Open in Track Order
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleClose}
                  className="min-h-[44px] w-full border border-[#E5E3DC] bg-white px-4 py-2 text-xs font-medium text-[#57534E] hover:border-[#181817] hover:text-[#181817]"
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
              className="space-y-5"
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

              {/* Member Discount / Sign In Banner */}
              {settings.newMemberDiscountEnabled &&
                settings.newMemberDiscountPercent > 0 && (
                  <div className="border border-[#181817] bg-[#FAFAFA] p-3.5 text-xs">
                    {member ? (
                      quote?.memberDiscount ? (
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#881337]">
                              {quote.memberLabel || "Member Discount Applied"}
                            </p>
                            <p className="mt-0.5 text-[#181817]">
                              Hemat{" "}
                              <strong className="tabular-nums">
                                {formatIDR(quote.memberDiscount)}
                              </strong>{" "}
                              otomatis sebagai member{" "}
                              <span className="font-medium">{member.name}</span>.
                            </p>
                          </div>
                          <span className="shrink-0 bg-[#181817] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                            -{settings.newMemberDiscountPercent}%
                          </span>
                        </div>
                      ) : member.newMemberEligible &&
                        settings.newMemberDiscountScope === "tags" ? (
                        <p className="text-[11px] text-[#57534E]">
                          Diskon member {settings.newMemberDiscountPercent}%
                          berlaku untuk produk bertag{" "}
                          <strong className="text-[#181817]">
                            {settings.newMemberDiscountTags
                              .map((t) => `#${t}`)
                              .join(", ")}
                          </strong>
                          .
                        </p>
                      ) : (
                        <p className="text-[11px] text-[#57534E]">
                          Masuk sebagai{" "}
                          <strong className="text-[#181817]">
                            {member.name}
                          </strong>{" "}
                          ({member.email}). Pesanan tersimpan di Purchase History.
                        </p>
                      )
                    ) : (
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#881337]">
                            Member Promo · -{settings.newMemberDiscountPercent}%
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#181817]">
                            Daftar / Login member untuk klaim diskon{" "}
                            {settings.newMemberDiscountPercent}% &amp; simpan
                            riwayat order.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onOpenAccount("register")}
                          className="min-h-[38px] shrink-0 bg-[#181817] px-3 text-[11px] font-medium text-white hover:bg-[#333330]"
                        >
                          Join / Sign In
                        </button>
                      </div>
                    )}
                  </div>
                )}

              {/* Voucher Code Box */}
              <div className="space-y-2 border border-[#E5E3DC] bg-white p-3.5 text-xs">
                <label
                  htmlFor="checkout-voucher-code"
                  className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-[#57534E]"
                >
                  Voucher Code (Optional)
                </label>
                <div className="flex gap-2">
                  <input
                    id="checkout-voucher-code"
                    type="text"
                    value={voucherInput}
                    onChange={(e) =>
                      setVoucherInput(e.target.value.toUpperCase())
                    }
                    placeholder="Contoh: MERIDIAN10"
                    className="min-h-[42px] flex-1 border border-[#E5E3DC] bg-white px-3 font-mono text-xs uppercase tracking-wider text-[#181817]"
                  />
                  {appliedVoucherCode ? (
                    <button
                      type="button"
                      onClick={() => {
                        setVoucherInput("");
                        setAppliedVoucherCode("");
                      }}
                      className="min-h-[42px] border border-[#881337] bg-white px-3.5 text-xs font-medium text-[#881337] hover:bg-[#FFF1F2]"
                    >
                      Hapus
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={quoteLoading || !voucherInput.trim()}
                      onClick={() => {
                        const code = voucherInput.trim().toUpperCase();
                        setAppliedVoucherCode(code);
                        void fetchQuote(items, code);
                      }}
                      className="min-h-[42px] bg-[#181817] px-4 text-xs font-medium text-white hover:bg-[#333330] disabled:opacity-50"
                    >
                      {quoteLoading ? "..." : "Apply"}
                    </button>
                  )}
                </div>
                {appliedVoucherCode && quote && (
                  <p
                    role={quote.voucherValid ? "status" : "alert"}
                    className={`text-[11px] ${
                      quote.voucherValid
                        ? "font-medium text-emerald-800"
                        : "text-[#881337]"
                    }`}
                  >
                    {quote.voucherValid
                      ? `${quote.voucherCode}: ${quote.voucherMessage} (-${formatIDR(quote.voucherDiscount)})`
                      : quote.voucherMessage || "Kode voucher tidak valid."}
                  </p>
                )}
              </div>

              {/* Section 1: Shipping Details */}
              <div className="space-y-3.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#57534E]">
                  1. Shipping Details
                </p>

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
                      onChange={(e) =>
                        handleFieldChange("email", e.target.value)
                      }
                      onBlur={() => handleFieldBlur("email")}
                      aria-invalid={Boolean(fieldErrors.email)}
                      aria-describedby={
                        fieldErrors.email ? "err-email" : undefined
                      }
                      placeholder="you@domain.com"
                      className={`mt-1 min-h-[44px] w-full border bg-white px-3 text-xs text-[#181817] ${
                        fieldErrors.email
                          ? "border-[#881337]"
                          : "border-[#E5E3DC]"
                      }`}
                    />
                    {fieldErrors.email && (
                      <p
                        id="err-email"
                        className="mt-1 text-[11px] text-[#881337]"
                      >
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
                      onChange={(e) =>
                        handleFieldChange("phone", e.target.value)
                      }
                      onBlur={() => handleFieldBlur("phone")}
                      aria-invalid={Boolean(fieldErrors.phone)}
                      aria-describedby={
                        fieldErrors.phone ? "err-phone" : undefined
                      }
                      placeholder="0812 3456 7890"
                      className={`mt-1 min-h-[44px] w-full border bg-white px-3 text-xs text-[#181817] ${
                        fieldErrors.phone
                          ? "border-[#881337]"
                          : "border-[#E5E3DC]"
                      }`}
                    />
                    {fieldErrors.phone && (
                      <p
                        id="err-phone"
                        className="mt-1 text-[11px] text-[#881337]"
                      >
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
                    onChange={(e) =>
                      handleFieldChange("address", e.target.value)
                    }
                    onBlur={() => handleFieldBlur("address")}
                    aria-invalid={Boolean(fieldErrors.address)}
                    aria-describedby={
                      fieldErrors.address ? "err-address" : undefined
                    }
                    placeholder="Jl. Kemang Raya No. 18, Jakarta Selatan"
                    className={`mt-1 w-full border bg-white p-3 text-xs text-[#181817] ${
                      fieldErrors.address
                        ? "border-[#881337]"
                        : "border-[#E5E3DC]"
                    }`}
                  />
                  {fieldErrors.address && (
                    <p
                      id="err-address"
                      className="mt-1 text-[11px] text-[#881337]"
                    >
                      {fieldErrors.address}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                      onChange={(e) =>
                        handleFieldChange("city", e.target.value)
                      }
                      onBlur={() => handleFieldBlur("city")}
                      aria-invalid={Boolean(fieldErrors.city)}
                      aria-describedby={
                        fieldErrors.city ? "err-city" : undefined
                      }
                      placeholder="Jakarta Selatan"
                      className={`mt-1 min-h-[44px] w-full border bg-white px-3 text-xs text-[#181817] ${
                        fieldErrors.city
                          ? "border-[#881337]"
                          : "border-[#E5E3DC]"
                      }`}
                    />
                    {fieldErrors.city && (
                      <p
                        id="err-city"
                        className="mt-1 text-[11px] text-[#881337]"
                      >
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
                      onChange={(e) =>
                        handleFieldChange("notes", e.target.value)
                      }
                      placeholder="Reception / preferred hours"
                      className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                    />
                  </div>
                </div>
              </div>

              {/* Section 2: BinderPay Payment Method Selector */}
              <fieldset className="space-y-3 border-t border-[#E5E3DC] pt-4">
                <div className="flex items-center justify-between gap-2">
                  <legend className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#57534E]">
                    2. Payment Method · BinderPay
                  </legend>
                  {gatewayConfig && (
                    <span
                      className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        gatewayConfig.configured
                          ? gatewayConfig.env === "production"
                            ? "bg-[#181817] text-white"
                            : "border border-[#181817] bg-[#FAFAFA] text-[#181817]"
                          : "bg-[#FFF1F2] text-[#881337]"
                      }`}
                    >
                      {gatewayConfig.configured
                        ? gatewayConfig.env === "production"
                          ? "SNAP BI Live"
                          : "Sandbox"
                        : "Setup Needed"}
                    </span>
                  )}
                </div>

                {gatewayConfig && !gatewayConfig.configured && (
                  <div className="border border-[#881337]/40 bg-[#FFF1F2] p-3 text-[11px] leading-relaxed text-[#881337]">
                    <p className="font-semibold">
                      Kredensial merchant BinderPay belum dipasang di server.
                    </p>
                    <p className="mt-0.5 text-[#181817]">
                      Set{" "}
                      <code className="font-mono">
                        {gatewayConfig.missingEnvVars.join(", ")}
                      </code>{" "}
                      di environment server (cek Admin → Store Settings untuk
                      panduan lengkap).
                    </p>
                  </div>
                )}

                {/* Instant QRIS */}
                {instantChannels.length > 0 && (
                  <div className="space-y-1.5">
                    {instantChannels.map((ch) => {
                      const active =
                        selectedPayment.paymentType === ch.paymentType &&
                        selectedPayment.channel === ch.channel;
                      return (
                        <button
                          key={ch.channel}
                          type="button"
                          onClick={() =>
                            setSelectedPayment({
                              paymentType: ch.paymentType,
                              channel: ch.channel,
                            })
                          }
                          aria-pressed={active}
                          className={`flex w-full items-start justify-between gap-3 border p-3.5 text-left transition-colors ${
                            active
                              ? "border-[#181817] bg-[#181817] text-white"
                              : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                          }`}
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold">
                                {ch.shortLabel} Instant
                              </span>
                              <span
                                className={`px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${
                                  active
                                    ? "bg-white text-[#181817]"
                                    : "bg-[#F5F5F5] text-[#57534E]"
                                }`}
                              >
                                Recommended
                              </span>
                            </div>
                            <p
                              className={`mt-1 text-[11px] leading-snug ${
                                active ? "text-[#D6D3CD]" : "text-[#57534E]"
                              }`}
                            >
                              {ch.description}
                            </p>
                          </div>
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              active ? "border-white" : "border-[#A8A29E]"
                            }`}
                          >
                            {active && (
                              <span className="h-2 w-2 rounded-full bg-white" />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Virtual Account Bank Grid */}
                {vaChannels.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[11px] font-medium text-[#57534E]">
                      Virtual Account (Verifikasi Otomatis)
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {vaChannels.map((ch) => {
                        const active =
                          selectedPayment.paymentType === ch.paymentType &&
                          selectedPayment.channel === ch.channel;
                        return (
                          <button
                            key={ch.channel}
                            type="button"
                            onClick={() =>
                              setSelectedPayment({
                                paymentType: ch.paymentType,
                                channel: ch.channel,
                              })
                            }
                            aria-pressed={active}
                            className={`min-h-[44px] border px-3 py-2 text-left transition-colors ${
                              active
                                ? "border-[#181817] bg-[#181817] text-white"
                                : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                            }`}
                          >
                            <p className="text-xs font-semibold">
                              {ch.shortLabel}
                            </p>
                            <p
                              className={`truncate text-[10px] ${
                                active ? "text-[#D6D3CD]" : "text-[#57534E]"
                              }`}
                            >
                              {ch.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Hosted Payment Link */}
                {hostedChannels.length > 0 && (
                  <div className="space-y-1.5">
                    {hostedChannels.map((ch) => {
                      const active =
                        selectedPayment.paymentType === ch.paymentType &&
                        selectedPayment.channel === ch.channel;
                      return (
                        <button
                          key={ch.channel}
                          type="button"
                          onClick={() =>
                            setSelectedPayment({
                              paymentType: ch.paymentType,
                              channel: ch.channel,
                            })
                          }
                          aria-pressed={active}
                          className={`flex w-full items-start justify-between gap-3 border p-3 text-left transition-colors ${
                            active
                              ? "border-[#181817] bg-[#181817] text-white"
                              : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                          }`}
                        >
                          <div>
                            <p className="text-xs font-semibold">{ch.label}</p>
                            <p
                              className={`mt-0.5 text-[11px] leading-snug ${
                                active ? "text-[#D6D3CD]" : "text-[#57534E]"
                              }`}
                            >
                              {ch.description}
                            </p>
                          </div>
                          <span
                            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              active ? "border-white" : "border-[#A8A29E]"
                            }`}
                          >
                            {active && (
                              <span className="h-2 w-2 rounded-full bg-white" />
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <p className="text-[11px] leading-relaxed text-[#57534E]">
                  Pembayaran diamankan dengan standar SNAP BI (RSA-SHA256) via
                  BinderPay. Pesanan otomatis terkonfirmasi segera setelah
                  pembayaran masuk.
                </p>
              </fieldset>
            </form>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-semibold text-[#181817]">
                Your bag is empty
              </p>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[#57534E]">
                Browse the collection to inspect any piece in photos or 3D, pick
                your size, and add it here.
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
        {items.length > 0 && step !== "payment" && step !== "receipt" && (
          <div className="border-t border-[#E5E3DC] bg-[#FAFAFA] px-5 py-4 sm:px-6">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-[#57534E]">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatIDR(subtotal)}</span>
              </div>
              {memberDiscount > 0 && (
                <div className="flex justify-between font-medium text-emerald-800">
                  <span>{quote?.memberLabel || "Member Discount"}</span>
                  <span className="tabular-nums">
                    -{formatIDR(memberDiscount)}
                  </span>
                </div>
              )}
              {voucherDiscount > 0 && (
                <div className="flex justify-between font-medium text-[#881337]">
                  <span>Voucher ({quote?.voucherCode || appliedVoucherCode})</span>
                  <span className="tabular-nums">
                    -{formatIDR(voucherDiscount)}
                  </span>
                </div>
              )}
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
                    key="btn-proceed-checkout"
                    type="button"
                    onClick={() => {
                      setSubmitError(null);
                      setFieldErrors({});
                      setStep("checkout");
                    }}
                    className="min-h-[48px] w-full bg-[#181817] px-4 py-3 text-xs font-medium tracking-wide text-white transition-colors hover:bg-[#333330]"
                  >
                    Proceed to Checkout
                  </button>
                  <button
                    key="btn-continue-shopping"
                    type="button"
                    onClick={handleClose}
                    className="min-h-[44px] w-full border border-[#181817] bg-white px-4 py-2 text-xs font-medium tracking-wide text-[#181817] transition-colors hover:bg-[#F5F5F5]"
                  >
                    Continue Shopping
                  </button>
                </>
              ) : (
                <button
                  key="btn-submit-checkout"
                  type="submit"
                  form="meridian-checkout-form"
                  disabled={submitting}
                  className="min-h-[48px] w-full bg-[#181817] px-4 py-3 text-xs font-medium tracking-wide tabular-nums text-white transition-colors hover:bg-[#333330] disabled:opacity-60"
                >
                  {submitting
                    ? "Creating BinderPay Invoice..."
                    : `Pay via ${
                        selectedChannelMeta?.shortLabel || selectedPayment.channel
                      } · ${formatIDR(grandTotal)}`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
