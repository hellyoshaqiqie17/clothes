"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { formatIDR } from "@/data/catalogProducts";
import type {
  BinderPayChannelOption,
  CheckoutPaymentSelection,
  PaymentTransaction,
  StoreOrder,
} from "@/types/catalog";

interface BinderPayPaymentPanelProps {
  order: StoreOrder;
  payment: PaymentTransaction;
  availableChannels: BinderPayChannelOption[];
  onOrderUpdated: (order: StoreOrder) => void;
  onTrackOrder?: (orderId: string) => void;
  compact?: boolean;
}

function formatCountdown(targetIso: string | null, nowMs: number): {
  label: string;
  expired: boolean;
} {
  if (!targetIso) return { label: "-", expired: false };
  const targetMs = new Date(targetIso).getTime();
  if (Number.isNaN(targetMs)) return { label: "-", expired: false };
  const diffSec = Math.max(0, Math.floor((targetMs - nowMs) / 1000));
  if (diffSec === 0) return { label: "00:00:00", expired: true };
  const h = Math.floor(diffSec / 3600);
  const m = Math.floor((diffSec % 3600) / 60);
  const s = diffSec % 60;
  return {
    label: [h, m, s].map((v) => String(v).padStart(2, "0")).join(":"),
    expired: false,
  };
}

function formatVaGroups(va: string): string {
  const digits = va.replace(/\s+/g, "");
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

function getBankInstructions(channel: string): string[] {
  switch (channel) {
    case "BCA":
      return [
        "Buka myBCA / BCA Mobile -> pilih Transfer -> BCA Virtual Account.",
        "Masukkan nomor Virtual Account di atas dan pastikan nama penerima sesuai.",
        "Konfirmasi nominal transfer lalu selesaikan dengan PIN.",
      ];
    case "MANDIRI":
      return [
        "Buka Livin' by Mandiri -> pilih Bayar / VA -> masukkan nomor Virtual Account.",
        "Periksa detail tagihan dan nominal pembayaran.",
        "Konfirmasi pembayaran dengan PIN Livin'.",
      ];
    case "BNI":
      return [
        "Buka wondr / BNI Mobile Banking -> pilih Transfer -> Virtual Account Billing.",
        "Masukkan nomor Virtual Account di atas lalu cek rincian tagihan.",
        "Masukkan password transaksi untuk menyelesaikan pembayaran.",
      ];
    case "BRI":
      return [
        "Buka BRImo -> pilih BRIVA -> Tambah Transaksi Baru.",
        "Tempel nomor Virtual Account lalu verifikasi nominal tagihan.",
        "Masukkan PIN BRImo hingga status transaksi berhasil.",
      ];
    default:
      return [
        `Buka aplikasi mobile banking atau ATM ${channel} dan pilih menu Virtual Account / Transfer VA.`,
        "Tempel nomor Virtual Account di atas dan periksa kesesuaian nama serta nominal.",
        "Selesaikan transfer; status pesanan diperbarui otomatis setelah dana diterima.",
      ];
  }
}

export default function BinderPayPaymentPanel({
  order,
  payment,
  availableChannels,
  onOrderUpdated,
  onTrackOrder,
  compact = false,
}: BinderPayPaymentPanelProps) {
  const [qrState, setQrState] = useState<{
    content: string;
    dataUrl: string | null;
    error: boolean;
  } | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [checking, setChecking] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showSwitchMenu, setShowSwitchMenu] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const pollingLockRef = useRef(false);
  const isPending = payment.status === "pending";

  // Generate high-contrast scannable QR PNG locally from EMVCo qrContent
  useEffect(() => {
    const content =
      payment.paymentType === "qris" ? payment.qrContent ?? "" : "";
    if (!content) return;
    let active = true;
    QRCode.toDataURL(content, {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: {
        dark: "#181817",
        light: "#FFFFFF",
      },
    })
      .then((url) => {
        if (!active) return;
        setQrState({ content, dataUrl: url, error: false });
      })
      .catch(() => {
        if (active) setQrState({ content, dataUrl: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [payment.paymentType, payment.qrContent]);

  const qrDataUrl =
    payment.paymentType === "qris" &&
    payment.qrContent &&
    qrState?.content === payment.qrContent
      ? qrState.dataUrl
      : null;
  const qrRenderError =
    payment.paymentType === "qris" &&
    payment.qrContent &&
    qrState?.content === payment.qrContent
      ? qrState.error
      : false;

  // Live 1-second countdown ticker while payment is pending
  useEffect(() => {
    if (!isPending || !payment.expiredAt) return;
    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(id);
  }, [isPending, payment.expiredAt]);

  const checkStatus = useCallback(
    async (manual = false) => {
      if (pollingLockRef.current) return;
      pollingLockRef.current = true;
      if (manual) {
        setChecking(true);
        setActionError(null);
      }
      try {
        const res = await fetch(
          `/api/payments/binderpay/status?orderId=${encodeURIComponent(order.id)}`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as {
          order?: StoreOrder;
          error?: string;
        };
        if (res.ok && data.order) {
          onOrderUpdated(data.order);
        } else if (manual && data.error) {
          setActionError(data.error);
        }
      } catch {
        if (manual) {
          setActionError("Gagal menghubungi server untuk mengecek status pembayaran.");
        }
      } finally {
        pollingLockRef.current = false;
        if (manual) setChecking(false);
      }
    },
    [order.id, onOrderUpdated]
  );

  // Automatic 4-second live polling while pending and browser tab is visible
  useEffect(() => {
    if (!isPending) return;
    const timer = window.setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      void checkStatus(false);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [isPending, checkStatus]);

  const countdown = useMemo(
    () => formatCountdown(payment.expiredAt, nowMs),
    [payment.expiredAt, nowMs]
  );

  // Trigger a final status verification immediately when countdown hits 00:00:00
  const expiryCheckedRef = useRef(false);
  useEffect(() => {
    if (isPending && countdown.expired && !expiryCheckedRef.current) {
      expiryCheckedRef.current = true;
      void checkStatus(false);
    }
    if (!countdown.expired) {
      expiryCheckedRef.current = false;
    }
  }, [isPending, countdown.expired, checkStatus]);

  const handleCopy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((cur) => (cur === key ? null : cur));
      }, 2000);
    } catch {
      setActionError("Clipboard tidak tersedia. Silakan salin secara manual.");
    }
  };

  const handleDownloadQr = () => {
    if (!qrDataUrl) return;
    const link = document.createElement("a");
    link.href = qrDataUrl;
    link.download = `Meridian-QRIS-${order.id}.png`;
    link.click();
  };

  const handleSwitchMethod = async (next: CheckoutPaymentSelection) => {
    setSwitching(true);
    setActionError(null);
    try {
      const res = await fetch("/api/payments/binderpay/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          paymentType: next.paymentType,
          channel: next.channel,
        }),
      });
      const data = (await res.json()) as {
        order?: StoreOrder;
        error?: string;
      };
      if (!res.ok || !data.order) {
        setActionError(data.error || "Gagal mengganti metode pembayaran.");
        return;
      }
      setShowSwitchMenu(false);
      setConfirmCancel(false);
      onOrderUpdated(data.order);
    } catch {
      setActionError("Gangguan jaringan saat mengganti metode pembayaran.");
    } finally {
      setSwitching(false);
    }
  };

  const handleCancelPayment = async () => {
    setCancelling(true);
    setActionError(null);
    try {
      const res = await fetch("/api/payments/binderpay/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          reason: "Cancelled by customer",
          cancelOrder: true,
        }),
      });
      const data = (await res.json()) as {
        order?: StoreOrder;
        error?: string;
      };
      if (!res.ok || !data.order) {
        setActionError(data.error || "Gagal membatalkan transaksi.");
        return;
      }
      setConfirmCancel(false);
      onOrderUpdated(data.order);
    } catch {
      setActionError("Gangguan jaringan saat membatalkan transaksi.");
    } finally {
      setCancelling(false);
    }
  };

  // --- PAID STATE ---
  if (payment.status === "paid") {
    return (
      <div className="space-y-4 border border-[#181817] bg-[#FAFAFA] p-5 text-xs text-[#181817]">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 bg-[#181817] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Payment Confirmed
          </span>
          <span className="font-mono text-[11px] text-[#57534E]">
            {order.id}
          </span>
        </div>

        <div>
          <p className="font-display text-2xl font-normal text-[#181817]">
            Terima kasih, {order.customerName || "Customer"}
          </p>
          <p className="mt-1 leading-relaxed text-[#57534E]">
            Pembayaran sebesar{" "}
            <strong className="font-semibold tabular-nums text-[#181817]">
              {formatIDR(payment.payableAmount)}
            </strong>{" "}
            melalui{" "}
            <strong className="font-medium text-[#181817]">
              {payment.issuerName
                ? `${payment.channel} (${payment.issuerName})`
                : payment.channel}
            </strong>{" "}
            telah terverifikasi otomatis via BinderPay.
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-2 border-t border-[#E5E3DC] pt-3 text-[11px]">
          <div>
            <dt className="text-[#57534E]">Transaction ID</dt>
            <dd className="mt-0.5 font-mono font-medium text-[#181817]">
              {payment.trxId}
            </dd>
          </div>
          {payment.referenceNo && (
            <div>
              <dt className="text-[#57534E]">Reference No</dt>
              <dd className="mt-0.5 font-mono font-medium text-[#181817]">
                {payment.referenceNo}
              </dd>
            </div>
          )}
          {payment.paidAt && (
            <div className="col-span-2">
              <dt className="text-[#57534E]">Paid At</dt>
              <dd className="mt-0.5 tabular-nums text-[#181817]">
                {new Date(payment.paidAt).toLocaleString("id-ID", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </dd>
            </div>
          )}
        </dl>

        {onTrackOrder && (
          <button
            type="button"
            onClick={() => onTrackOrder(order.id)}
            className="min-h-[44px] w-full bg-[#181817] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#333330]"
          >
            Track Order Status
          </button>
        )}
      </div>
    );
  }

  // --- EXPIRED / CANCELLED / FAILED STATE ---
  if (payment.status !== "pending") {
    return (
      <div className="space-y-4 border border-[#881337] bg-[#FFF1F2] p-4 text-xs text-[#881337]">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em]">
            Payment {payment.status}
          </p>
          <p className="mt-1 leading-relaxed text-[#181817]">
            {payment.status === "expired"
              ? "Batas waktu pembayaran telah berakhir. Anda dapat membuat tagihan baru untuk pesanan ini."
              : payment.status === "cancelled"
              ? "Transaksi pembayaran ini telah dibatalkan. Pilih metode pembayaran baru jika ingin melanjutkan pesanan."
              : "Transaksi pembayaran gagal diproses. Silakan coba lagi dengan metode yang sama atau berbeda."}
          </p>
        </div>

        {actionError && (
          <p role="alert" className="text-[11px] font-medium text-[#881337]">
            {actionError}
          </p>
        )}

        {availableChannels.length > 0 && (
          <div className="space-y-2 border-t border-[#FECDD3] pt-3">
            <p className="text-[11px] font-semibold text-[#181817]">
              Buat Ulang Pembayaran untuk {order.id}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {availableChannels.slice(0, 6).map((ch) => (
                <button
                  key={`${ch.paymentType}-${ch.channel}`}
                  type="button"
                  disabled={switching}
                  onClick={() =>
                    void handleSwitchMethod({
                      paymentType: ch.paymentType,
                      channel: ch.channel,
                    })
                  }
                  className="min-h-[40px] border border-[#181817] bg-white px-2.5 text-[11px] font-medium text-[#181817] transition-colors hover:bg-[#181817] hover:text-white disabled:opacity-50"
                >
                  {switching ? "..." : ch.shortLabel}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- PENDING ACTIVE PAYMENT STATE ---
  return (
    <div className="space-y-4 border border-[#181817] bg-white p-4 text-xs text-[#181817] sm:p-5">
      {/* Top Status & Countdown */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E3DC] pb-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#881337]">
            Awaiting Payment · BinderPay
          </p>
          <p className="mt-0.5 font-mono text-xs font-semibold text-[#181817]">
            {order.id}
          </p>
        </div>
        {payment.expiredAt && (
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-[0.1em] text-[#57534E]">
              Expires In
            </p>
            <p
              className={`font-mono text-sm font-semibold tabular-nums ${
                countdown.expired ? "text-[#881337]" : "text-[#181817]"
              }`}
            >
              {countdown.label}
            </p>
          </div>
        )}
      </div>

      {/* Payable Amount Summary */}
      <div className="flex items-center justify-between gap-3 bg-[#FAFAFA] px-3.5 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.1em] text-[#57534E]">
            Total Pembayaran
          </p>
          <p className="mt-0.5 text-lg font-semibold tabular-nums text-[#181817]">
            {formatIDR(payment.payableAmount)}
          </p>
          {payment.feeAmount > 0 && (
            <p className="text-[10px] tabular-nums text-[#57534E]">
              Termasuk biaya layanan {formatIDR(payment.feeAmount)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void handleCopy("amount", String(payment.payableAmount))}
          className="min-h-[38px] border border-[#E5E3DC] bg-white px-3 text-[11px] font-medium text-[#181817] transition-colors hover:border-[#181817]"
        >
          {copiedKey === "amount" ? "Copied" : "Copy Nominal"}
        </button>
      </div>

      {/* CHANNEL-SPECIFIC PAYMENT DETAILS */}
      {payment.paymentType === "qris" && (
        <div className="space-y-3">
          <div className="flex flex-col items-center border border-[#E5E3DC] bg-[#FAFAFA] p-4">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#181817]">
              <span>QRIS</span>
              <span className="text-[#57534E]">·</span>
              <span className="font-normal text-[#57534E]">
                All E-Wallets &amp; Banks
              </span>
            </div>

            {qrDataUrl && !qrRenderError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={qrDataUrl}
                alt={`QRIS payment code for order ${order.id}`}
                width={compact ? 210 : 240}
                height={compact ? 210 : 240}
                className="border border-[#E5E3DC] bg-white p-2"
              />
            ) : payment.qrUrl ? (
              <a
                href={payment.qrUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="min-h-[44px] inline-flex items-center justify-center bg-[#181817] px-4 text-xs font-medium text-white"
              >
                Buka Halaman QRIS
              </a>
            ) : (
              <div className="flex h-48 w-48 items-center justify-center border border-[#E5E3DC] bg-white text-[11px] text-[#57534E]">
                Generating QR...
              </div>
            )}

            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {qrDataUrl && (
                <button
                  type="button"
                  onClick={handleDownloadQr}
                  className="min-h-[40px] border border-[#181817] bg-white px-3.5 text-[11px] font-medium text-[#181817] transition-colors hover:bg-[#181817] hover:text-white"
                >
                  Download QR (.PNG)
                </button>
              )}
              {payment.qrUrl && (
                <a
                  href={payment.qrUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[40px] items-center border border-[#E5E3DC] bg-white px-3.5 text-[11px] font-medium text-[#181817] hover:border-[#181817]"
                >
                  Buka Link QR
                </a>
              )}
            </div>
          </div>

          <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-[#57534E]">
            <li>Buka aplikasi GoPay, OVO, DANA, ShopeePay, atau Mobile Banking.</li>
            <li>Pilih Scan QRIS lalu pindai kode di atas (atau unggah gambar QR).</li>
            <li>Pastikan nominal sesuai, lalu konfirmasi pembayaran. Status terupdate otomatis.</li>
          </ol>
        </div>
      )}

      {payment.paymentType === "va" && (
        <div className="space-y-3">
          <div className="space-y-2.5 border border-[#E5E3DC] bg-[#FAFAFA] p-4">
            <div className="flex items-center justify-between gap-2">
              <span className="bg-[#181817] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-white">
                {payment.channel} Virtual Account
              </span>
              {payment.virtualAccountName && (
                <span className="truncate text-[11px] text-[#57534E]">
                  a.n. {payment.virtualAccountName}
                </span>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border border-[#E5E3DC] bg-white px-3.5 py-3">
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.1em] text-[#57534E]">
                  Nomor Virtual Account
                </p>
                <p className="mt-0.5 break-all font-mono text-base font-semibold tracking-wider text-[#181817]">
                  {formatVaGroups(payment.virtualAccountNo || "")}
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  void handleCopy("va", payment.virtualAccountNo || "")
                }
                className="min-h-[40px] shrink-0 bg-[#181817] px-3.5 text-[11px] font-medium text-white transition-colors hover:bg-[#333330]"
              >
                {copiedKey === "va" ? "Copied" : "Copy VA"}
              </button>
            </div>
          </div>

          <ol className="list-decimal space-y-1 pl-4 text-[11px] leading-relaxed text-[#57534E]">
            {getBankInstructions(payment.channel).map((step, idx) => (
              <li key={idx}>{step}</li>
            ))}
          </ol>
        </div>
      )}

      {payment.paymentType === "payment_link" && (
        <div className="space-y-3 border border-[#E5E3DC] bg-[#FAFAFA] p-4">
          <p className="text-xs font-semibold text-[#181817]">
            BinderPay Hosted Checkout
          </p>
          <p className="text-[11px] leading-relaxed text-[#57534E]">
            Klik tombol di bawah untuk menyelesaikan pembayaran di halaman resmi
            BinderPay (mendukung QRIS &amp; seluruh Virtual Account).
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            {payment.paymentUrl && (
              <a
                href={payment.paymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[44px] flex-1 items-center justify-center bg-[#181817] px-4 text-xs font-medium text-white transition-colors hover:bg-[#333330]"
              >
                Bayar di BinderPay ↗
              </a>
            )}
            {payment.paymentUrl && (
              <button
                type="button"
                onClick={() => void handleCopy("link", payment.paymentUrl || "")}
                className="min-h-[44px] border border-[#181817] bg-white px-4 text-xs font-medium text-[#181817] hover:bg-[#F5F5F5]"
              >
                {copiedKey === "link" ? "Copied" : "Copy Link"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Error Alert */}
      {actionError && (
        <p
          role="alert"
          className="border border-[#881337] bg-[#FFF1F2] px-3 py-2 text-[11px] text-[#881337]"
        >
          {actionError}
        </p>
      )}

      {/* Live Status Actions */}
      <div className="space-y-2 border-t border-[#E5E3DC] pt-3">
        <button
          type="button"
          disabled={checking}
          onClick={() => void checkStatus(true)}
          className="min-h-[44px] w-full bg-[#181817] px-4 text-xs font-medium text-white transition-colors hover:bg-[#333330] disabled:opacity-60"
        >
          {checking
            ? "Checking BinderPay Status..."
            : "Saya Sudah Bayar · Cek Status"}
        </button>

        <p className="text-center text-[10px] text-[#57534E]">
          Status dicek otomatis setiap beberapa detik.
        </p>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          {availableChannels.length > 1 && (
            <button
              type="button"
              onClick={() => setShowSwitchMenu((v) => !v)}
              className="min-h-[38px] border border-[#E5E3DC] bg-white px-3 text-[11px] font-medium text-[#181817] hover:border-[#181817]"
            >
              {showSwitchMenu ? "Tutup Pilihan" : "Ganti Metode Bayar"}
            </button>
          )}

          {confirmCancel ? (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={cancelling}
                onClick={() => void handleCancelPayment()}
                className="min-h-[38px] bg-[#881337] px-3 text-[11px] font-medium text-white hover:bg-[#9F1239] disabled:opacity-60"
              >
                {cancelling ? "Membatalkan..." : "Konfirmasi Batal"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmCancel(false)}
                className="min-h-[38px] border border-[#E5E3DC] px-2.5 text-[11px] text-[#57534E]"
              >
                Kembali
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmCancel(true)}
              className="min-h-[38px] border border-[#E5E3DC] bg-white px-3 text-[11px] font-medium text-[#881337] hover:border-[#881337]"
            >
              Batalkan Transaksi
            </button>
          )}
        </div>

        {/* Inline Switch Payment Method Picker */}
        {showSwitchMenu && (
          <div className="space-y-2 border border-[#E5E3DC] bg-[#FAFAFA] p-3">
            <p className="text-[11px] font-semibold text-[#181817]">
              Pilih metode baru (tagihan lama otomatis dibatalkan):
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {availableChannels.map((ch) => {
                const isCurrent =
                  ch.paymentType === payment.paymentType &&
                  ch.channel === payment.channel;
                return (
                  <button
                    key={`${ch.paymentType}-${ch.channel}`}
                    type="button"
                    disabled={switching || isCurrent}
                    onClick={() =>
                      void handleSwitchMethod({
                        paymentType: ch.paymentType,
                        channel: ch.channel,
                      })
                    }
                    className={`min-h-[38px] border px-2.5 text-[11px] font-medium transition-colors ${
                      isCurrent
                        ? "border-[#181817] bg-[#181817] text-white opacity-60"
                        : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                    }`}
                  >
                    {ch.shortLabel}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
