"use client";

import { useCallback, useEffect, useState } from "react";
import { formatIDR } from "@/data/catalogProducts";
import {
  badgeToneClasses,
  formatOrderTimestamp,
  getFulfillmentBadge,
  getOrderTrackingSteps,
  getPaymentBadge,
  isOrderShipped,
} from "@/lib/orderStatus";
import BinderPayPaymentPanel from "@/components/marketplace/BinderPayPaymentPanel";
import type {
  BinderPayChannelOption,
  BinderPayConfigStatus,
  MemberProfile,
  StoreOrder,
} from "@/types/catalog";

interface TrackOrderModalProps {
  open: boolean;
  initialOrderId?: string;
  member?: MemberProfile | null;
  supportEmail: string;
  onClose: () => void;
}

export default function TrackOrderModal({
  open,
  initialOrderId = "",
  member = null,
  supportEmail,
  onClose,
}: TrackOrderModalProps) {
  const [queryId, setQueryId] = useState(initialOrderId);
  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [memberOrders, setMemberOrders] = useState<StoreOrder[]>([]);
  const [memberOrdersLoading, setMemberOrdersLoading] = useState(false);
  const [channels, setChannels] = useState<BinderPayChannelOption[]>([]);
  const [loading, setLoading] = useState(Boolean(open && initialOrderId));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedResi, setCopiedResi] = useState(false);

  const lookupOrder = useCallback(async (rawId: string) => {
    const cleaned = rawId.trim().toUpperCase();
    if (!cleaned) {
      setErrorMsg("Masukkan Order Reference ID Anda (contoh: ORD-A1B2C3).");
      return;
    }
    setQueryId(cleaned);
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/payments/binderpay/status?orderId=${encodeURIComponent(cleaned)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as { order?: StoreOrder; error?: string };
      if (!res.ok || !data.order) {
        setOrder(null);
        setErrorMsg(data.error || "Pesanan dengan ID tersebut tidak ditemukan.");
        return;
      }
      setOrder(data.order);
      setMemberOrders((prev) =>
        prev.map((o) => (o.id === data.order!.id ? data.order! : o))
      );
    } catch {
      setErrorMsg("Gagal menghubungi server. Silakan coba lagi.");
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
    if (!open) return;
    let active = true;
    fetch("/api/payments/binderpay/config", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as BinderPayConfigStatus;
        if (active) setChannels(data.channels ?? []);
      })
      .catch(() => {
        // optional enhancement
      });
    return () => {
      active = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !member) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setMemberOrdersLoading(true);
      fetch("/api/member/orders", { cache: "no-store" })
        .then(async (res) => {
          if (!res.ok) return;
          const data = (await res.json()) as { orders?: StoreOrder[] };
          if (!cancelled) {
            setMemberOrders(data.orders ?? []);
          }
        })
        .catch(() => {
          // non-blocking
        })
        .finally(() => {
          if (!cancelled) setMemberOrdersLoading(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, member]);

  useEffect(() => {
    if (!open || !initialOrderId.trim()) return;
    let cancelled = false;
    const cleaned = initialOrderId.trim().toUpperCase();
    fetch(
      `/api/payments/binderpay/status?orderId=${encodeURIComponent(cleaned)}`,
      { cache: "no-store" }
    )
      .then(async (res) => {
        const data = (await res.json()) as {
          order?: StoreOrder;
          error?: string;
        };
        if (cancelled) return;
        if (!res.ok || !data.order) {
          setOrder(null);
          setErrorMsg(
            data.error || "Pesanan dengan ID tersebut tidak ditemukan."
          );
        } else {
          setErrorMsg(null);
          setOrder(data.order);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setErrorMsg("Gagal menghubungi server. Silakan coba lagi.");
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

  const payment = order?.payment ?? null;
  const payBadge = order ? getPaymentBadge(order) : null;
  const fulfillmentBadge = order ? getFulfillmentBadge(order) : null;
  const steps = order ? getOrderTrackingSteps(order) : [];
  const shipped = order ? isOrderShipped(order) : false;
  const shippedAtLabel = order ? formatOrderTimestamp(order.shippedAt) : null;
  const completedAtLabel = order ? formatOrderTimestamp(order.completedAt) : null;

  const handleCopyResi = async (resi: string) => {
    try {
      await navigator.clipboard.writeText(resi);
      setCopiedResi(true);
      window.setTimeout(() => setCopiedResi(false), 2000);
    } catch {
      // clipboard unavailable
    }
  };

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
      <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden bg-white text-[#181817] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E5E3DC] px-6 py-4">
          <div>
            <h2
              id="track-order-title"
              className="font-display text-xl font-medium tracking-tight text-[#181817]"
            >
              Track Your Order
            </h2>
            <p className="mt-0.5 text-[11px] text-[#57534E]">
              Pantau status pembayaran, pengiriman, resi, hingga pesanan selesai.
            </p>
          </div>
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

          {order && payBadge && fulfillmentBadge && (
            <div className="space-y-5 border-t border-[#E5E3DC] pt-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#57534E]">
                      Order Reference
                    </p>
                    {member && memberOrders.length > 1 && (
                      <button
                        type="button"
                        onClick={() => {
                          setOrder(null);
                          setQueryId("");
                        }}
                        className="text-[11px] font-medium underline text-[#57534E] hover:text-[#181817]"
                      >
                        Semua Pesanan Saya ({memberOrders.length})
                      </button>
                    )}
                  </div>
                  <p className="mt-0.5 font-mono text-base font-semibold tracking-wide text-[#181817]">
                    {order.id}
                  </p>
                  <p className="mt-0.5 text-[11px] tabular-nums text-[#57534E]">
                    Dibuat{" "}
                    {new Date(order.createdAt).toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    className={`px-2 py-1 text-[10px] font-semibold uppercase tracking-wider ${badgeToneClasses(
                      payBadge.tone
                    )}`}
                  >
                    {payBadge.label}
                  </span>
                  <span
                    className={`px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${badgeToneClasses(
                      fulfillmentBadge.tone
                    )}`}
                  >
                    {fulfillmentBadge.label}
                  </span>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void lookupOrder(order.id)}
                    className="min-h-[30px] border border-[#E5E3DC] bg-white px-2 text-[10px] font-medium text-[#181817] hover:border-[#181817] disabled:opacity-50"
                  >
                    {loading ? "..." : "Refresh"}
                  </button>
                </div>
              </div>

              {/* Active / Resumable BinderPay Payment Panel when unpaid or expired */}
              {payment && payment.status !== "paid" && (
                <BinderPayPaymentPanel
                  order={order}
                  payment={payment}
                  availableChannels={channels}
                  onOrderUpdated={(updated) => setOrder(updated)}
                  compact
                />
              )}

              {/* 4-Stage Tracking Timeline */}
              {order.status === "cancelled" && !payment ? (
                <div className="border border-[#881337] bg-[#FFF1F2] p-3.5 text-xs text-[#881337]">
                  Pesanan ini telah dibatalkan. Hubungi{" "}
                  <span className="font-semibold">{supportEmail}</span> jika
                  Anda membutuhkan bantuan.
                </div>
              ) : order.status !== "cancelled" ? (
                <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {steps.map((step) => {
                    const isDone = step.state === "done";
                    const isCurrent = step.state === "current";
                    return (
                      <li
                        key={step.key}
                        className={`border p-3 ${
                          isDone
                            ? "border-[#181817] bg-[#181817] text-white"
                            : isCurrent
                            ? "border-[#181817] bg-[#FAFAFA] text-[#181817]"
                            : "border-[#E5E3DC] bg-white text-[#181817] opacity-60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p
                            className={`text-[10px] font-semibold uppercase tracking-wider tabular-nums ${
                              isDone ? "text-white/75" : "text-[#57534E]"
                            }`}
                          >
                            {step.stepNumber} · {step.title}
                          </p>
                          <span
                            className={`text-[10px] font-semibold uppercase tracking-wider ${
                              isDone
                                ? "text-emerald-300"
                                : isCurrent
                                ? "text-[#881337]"
                                : "text-[#57534E]"
                            }`}
                          >
                            {isDone
                              ? "Selesai"
                              : isCurrent
                              ? "Aktif"
                              : "Menunggu"}
                          </span>
                        </div>
                        <p className="mt-1 text-xs font-semibold">
                          {step.statusLabel}
                        </p>
                        <p
                          className={`mt-0.5 text-[11px] ${
                            isDone ? "text-white/80" : "text-[#57534E]"
                          }`}
                        >
                          {step.detail}
                        </p>
                      </li>
                    );
                  })}
                </ol>
              ) : null}

              {/* Shipping & Tracking Info Card */}
              {(shipped || order.shippingCourier || order.trackingNumber) && (
                <div className="flex flex-wrap items-center justify-between gap-3 border border-[#181817] bg-[#FAFAFA] p-3.5 text-xs">
                  <div className="space-y-1">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#57534E]">
                      Info Pengiriman &amp; Resi
                    </p>
                    <p className="font-semibold text-[#181817]">
                      {order.shippingCourier || "Ekspedisi Reguler"}
                      {order.trackingNumber ? (
                        <>
                          {" "}
                          ·{" "}
                          <span className="font-mono">
                            {order.trackingNumber}
                          </span>
                        </>
                      ) : (
                        <span className="font-normal text-[#57534E]">
                          {" "}
                          (Nomor resi menyusul)
                        </span>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tabular-nums text-[#57534E]">
                      {shippedAtLabel && (
                        <span>Dikirim: {shippedAtLabel}</span>
                      )}
                      {completedAtLabel && (
                        <span className="font-medium text-emerald-800">
                          Selesai: {completedAtLabel}
                        </span>
                      )}
                    </div>
                  </div>
                  {order.trackingNumber && (
                    <button
                      type="button"
                      onClick={() => void handleCopyResi(order.trackingNumber || "")}
                      className="min-h-[38px] shrink-0 border border-[#181817] bg-white px-3 text-[11px] font-medium text-[#181817] hover:bg-[#181817] hover:text-white"
                    >
                      {copiedResi ? "Resi Tersalin" : "Salin Resi"}
                    </button>
                  )}
                </div>
              )}

              {/* Verified Payment Receipt Summary when Paid */}
              {payment && payment.status === "paid" && (
                <div className="space-y-1 border border-[#E5E3DC] bg-[#FAFAFA] p-3.5 text-xs">
                  <p className="font-semibold text-[#181817]">
                    BinderPay Verified Payment
                  </p>
                  <p className="text-[#57534E]">
                    Channel:{" "}
                    <strong className="font-medium text-[#181817]">
                      {payment.issuerName
                        ? `${payment.channel} (${payment.issuerName})`
                        : payment.channel}
                    </strong>
                    {payment.referenceNo && (
                      <>
                        {" "}
                        · Ref{" "}
                        <span className="font-mono text-[#181817]">
                          {payment.referenceNo}
                        </span>
                      </>
                    )}
                  </p>
                  {payment.paidAt && (
                    <p className="text-[11px] tabular-nums text-[#57534E]">
                      Paid at{" "}
                      {new Date(payment.paidAt).toLocaleString("id-ID", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  )}
                </div>
              )}

              {order.customerName && (
                <div className="space-y-1 border border-[#E5E3DC] bg-[#FAFAFA] p-3.5 text-xs">
                  <p className="font-semibold text-[#181817]">
                    Shipping Details
                  </p>
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
                        <span className="text-[#57534E]">
                          (Size {item.size})
                        </span>
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
                  <span className="tabular-nums">
                    {formatIDR(order.subtotal)}
                  </span>
                </div>
                {(order.memberDiscount ?? 0) > 0 && (
                  <div className="flex justify-between font-medium text-emerald-800">
                    <span>Member Discount</span>
                    <span className="tabular-nums">
                      -{formatIDR(order.memberDiscount ?? 0)}
                    </span>
                  </div>
                )}
                {(order.voucherDiscount ?? 0) > 0 && (
                  <div className="flex justify-between font-medium text-[#881337]">
                    <span>Voucher ({order.voucherCode})</span>
                    <span className="tabular-nums">
                      -{formatIDR(order.voucherDiscount ?? 0)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-[#57534E]">
                  <span>Shipping</span>
                  <span className="tabular-nums">
                    {order.shippingFee === 0
                      ? "Free"
                      : formatIDR(order.shippingFee)}
                  </span>
                </div>
                {payment && payment.feeAmount > 0 && (
                  <div className="flex justify-between text-[#57534E]">
                    <span>Payment Service Fee</span>
                    <span className="tabular-nums">
                      {formatIDR(payment.feeAmount)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between pt-1 text-sm font-semibold text-[#181817]">
                  <span>Total</span>
                  <span className="tabular-nums">
                    {formatIDR(payment?.payableAmount || order.total)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Member Quick-Pick Order List when no order selected yet */}
          {!order && member && (
            <div className="space-y-2.5 border-t border-[#E5E3DC] pt-4">
              <p className="text-xs font-semibold text-[#181817]">
                Riwayat Pesanan Anda ({memberOrders.length})
              </p>
              {memberOrdersLoading ? (
                <p className="text-xs text-[#57534E]">
                  Memuat daftar pesanan Anda...
                </p>
              ) : memberOrders.length === 0 ? (
                <p className="text-xs text-[#57534E]">
                  Belum ada pesanan pada akun{" "}
                  <span className="font-medium text-[#181817]">
                    {member.email}
                  </span>
                  .
                </p>
              ) : (
                <ul className="divide-y divide-[#E5E3DC] border border-[#E5E3DC]">
                  {memberOrders.map((ord) => {
                    const pBadge = getPaymentBadge(ord);
                    const fBadge = getFulfillmentBadge(ord);
                    return (
                      <li key={ord.id}>
                        <button
                          type="button"
                          onClick={() => void lookupOrder(ord.id)}
                          className="flex w-full flex-col gap-1.5 bg-white p-3 text-left transition-colors hover:bg-[#FAFAFA]"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="font-mono text-xs font-semibold text-[#181817]">
                              {ord.id}
                            </span>
                            <div className="flex flex-wrap items-center gap-1">
                              <span
                                className={`px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badgeToneClasses(
                                  pBadge.tone
                                )}`}
                              >
                                {pBadge.shortLabel}
                              </span>
                              <span
                                className={`px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badgeToneClasses(
                                  fBadge.tone
                                )}`}
                              >
                                {fBadge.shortLabel}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-[#57534E]">
                            <span>
                              {ord.itemCount} item ·{" "}
                              {new Date(ord.createdAt).toLocaleDateString(
                                "id-ID",
                                { dateStyle: "medium" }
                              )}
                            </span>
                            <span className="font-semibold tabular-nums text-[#181817]">
                              {formatIDR(ord.total)}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}

          {!order && !errorMsg && !member && (
            <p className="text-xs leading-relaxed text-[#57534E]">
              Masukkan Order Reference ID dari bukti checkout Anda untuk melihat
              status pembayaran, pengiriman, resi, hingga pesanan selesai.
              Butuh bantuan? Hubungi{" "}
              <span className="font-medium text-[#181817]">{supportEmail}</span>
              .
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
