"use client";

import { useCallback, useEffect, useState } from "react";
import { formatIDR } from "@/data/catalogProducts";
import type { OrderStatus, StoreOrder } from "@/types/catalog";

interface TrackOrderModalProps {
  open: boolean;
  initialOrderId?: string;
  supportEmail: string;
  onClose: () => void;
}

const STEPS: { key: Exclude<OrderStatus, "cancelled">; label: string; detail: string }[] = [
  {
    key: "pending",
    label: "Order Recorded",
    detail: "Awaiting manual confirmation",
  },
  {
    key: "confirmed",
    label: "Confirmed",
    detail: "Packed & prepared for dispatch",
  },
  {
    key: "shipped",
    label: "Shipped",
    detail: "Handed to courier",
  },
];

function getStepIndex(status: OrderStatus): number {
  if (status === "shipped") return 2;
  if (status === "confirmed") return 1;
  if (status === "pending") return 0;
  return -1;
}

export default function TrackOrderModal({
  open,
  initialOrderId = "",
  supportEmail,
  onClose,
}: TrackOrderModalProps) {
  const [queryId, setQueryId] = useState(initialOrderId);
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [loading, setLoading] = useState(Boolean(open && initialOrderId));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lookupOrder = useCallback(async (rawId: string) => {
    const cleaned = rawId.trim().toUpperCase();
    if (!cleaned) {
      setErrorMsg("Enter your order reference ID (e.g. ORD-A1B2C3).");
      return;
    }
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(cleaned)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as { order?: StoreOrder; error?: string };
      if (!res.ok || !data.order) {
        setOrder(null);
        setErrorMsg(data.error || "No order found with that reference ID.");
        return;
      }
      setOrder(data.order);
    } catch {
      setErrorMsg("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !initialOrderId.trim()) return;
    let cancelled = false;
    const cleaned = initialOrderId.trim().toUpperCase();
    fetch(`/api/orders/${encodeURIComponent(cleaned)}`, { cache: "no-store" })
      .then(async (res) => {
        const data = (await res.json()) as { order?: StoreOrder; error?: string };
        if (cancelled) return;
        if (!res.ok || !data.order) {
          setOrder(null);
          setErrorMsg(data.error || "No order found with that reference ID.");
        } else {
          setErrorMsg(null);
          setOrder(data.order);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMsg("Could not reach the server. Please try again.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, initialOrderId]);

  if (!open) return null;

  const currentStep = order ? getStepIndex(order.status) : -1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="track-order-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden bg-white text-[#181817] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E5E3DC] px-6 py-4">
          <h2
            id="track-order-title"
            className="font-display text-xl font-medium tracking-tight text-[#181817]"
          >
            Track Your Order
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close order tracker"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] text-base font-medium text-[#181817] transition-colors hover:bg-[#F5F5F5]"
          >
            ×
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void lookupOrder(queryId);
            }}
            noValidate
            className="space-y-2"
          >
            <label
              htmlFor="track-order-input"
              className="block text-xs font-medium text-[#181817]"
            >
              Order Reference ID
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="track-order-input"
                type="text"
                value={queryId}
                onChange={(e) => {
                  setQueryId(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                placeholder="ORD-A1B2C3"
                className="min-h-[44px] flex-1 border border-[#E5E3DC] bg-white px-3.5 text-xs uppercase tracking-wider text-[#181817] placeholder:normal-case placeholder:tracking-normal placeholder:text-[#57534E]"
              />
              <button
                type="submit"
                disabled={loading}
                className="min-h-[44px] bg-[#181817] px-5 text-xs font-medium tracking-wide text-white transition-colors hover:bg-[#333330] disabled:opacity-60"
              >
                {loading ? "Checking..." : "Track Order"}
              </button>
            </div>
            {errorMsg && (
              <p role="alert" className="text-xs text-[#881337]">
                {errorMsg}
              </p>
            )}
          </form>

          {order && (
            <div className="space-y-5 border-t border-[#E5E3DC] pt-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#57534E]">
                    Order Reference
                  </p>
                  <p className="mt-0.5 text-base font-semibold tracking-wide text-[#181817]">
                    {order.id}
                  </p>
                </div>
                <span
                  className={`px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                    order.status === "cancelled"
                      ? "bg-[#FFF1F2] text-[#881337]"
                      : order.status === "shipped"
                      ? "bg-[#181817] text-white"
                      : "border border-[#181817] bg-white text-[#181817]"
                  }`}
                >
                  {order.status}
                </span>
              </div>

              {order.status === "cancelled" ? (
                <div className="border border-[#881337] bg-[#FFF1F2] p-3.5 text-xs text-[#881337]">
                  This order has been cancelled. Contact{" "}
                  <span className="font-semibold">{supportEmail}</span> if you need
                  assistance.
                </div>
              ) : (
                <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {STEPS.map((step, idx) => {
                    const reached = idx <= currentStep;
                    return (
                      <li
                        key={step.key}
                        className={`border p-3 ${
                          reached
                            ? "border-[#181817] bg-[#FAFAFA]"
                            : "border-[#E5E3DC] bg-white opacity-60"
                        }`}
                      >
                        <p className="text-[11px] font-semibold tabular-nums text-[#57534E]">
                          0{idx + 1}
                        </p>
                        <p className="mt-0.5 text-xs font-semibold text-[#181817]">
                          {step.label}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[#57534E]">
                          {step.detail}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              )}

              {order.customerName && (
                <div className="space-y-1 border border-[#E5E3DC] bg-[#FAFAFA] p-3.5 text-xs">
                  <p className="font-semibold text-[#181817]">Shipping Details</p>
                  <p className="text-[#181817]">
                    {order.customerName} · {order.customerPhone}
                  </p>
                  <p className="text-[#57534E]">
                    {order.shippingAddress}, {order.shippingCity}
                  </p>
                  <p className="text-[11px] text-[#57534E]">
                    {order.paymentMethod}
                  </p>
                </div>
              )}

              <div>
                <p className="text-xs font-semibold text-[#181817]">
                  Items ({order.itemCount})
                </p>
                <ul className="mt-2 divide-y divide-[#E5E3DC] border border-[#E5E3DC]">
                  {order.items.map((item) => (
                    <li
                      key={item.key}
                      className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                    >
                      <span className="min-w-0 truncate text-[#181817]">
                        {item.quantity}x {item.title}{" "}
                        <span className="text-[#57534E]">(Size {item.size})</span>
                      </span>
                      <span className="shrink-0 font-semibold tabular-nums text-[#181817]">
                        {formatIDR(item.price * item.quantity)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-1.5 border-t border-[#E5E3DC] pt-3 text-xs">
                <div className="flex justify-between text-[#57534E]">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{formatIDR(order.subtotal)}</span>
                </div>
                <div className="flex justify-between text-[#57534E]">
                  <span>Shipping</span>
                  <span className="tabular-nums">
                    {order.shippingFee === 0 ? "Free" : formatIDR(order.shippingFee)}
                  </span>
                </div>
                <div className="flex justify-between pt-1 text-sm font-semibold text-[#181817]">
                  <span>Total</span>
                  <span className="tabular-nums">{formatIDR(order.total)}</span>
                </div>
              </div>
            </div>
          )}

          {!order && !errorMsg && (
            <p className="text-xs leading-relaxed text-[#57534E]">
              Enter the reference ID shown on your checkout receipt to see live order
              confirmation and dispatch status. Need help? Write to{" "}
              <span className="font-medium text-[#181817]">{supportEmail}</span>.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
