import type { OrderStatus, StoreOrder } from "@/types/catalog";

export type BadgeTone = "emerald" | "dark" | "rose" | "outline" | "neutral";

export interface OrderBadgeInfo {
  label: string;
  shortLabel: string;
  tone: BadgeTone;
}

export type OrderFilterBucket =
  | "all"
  | "unpaid"
  | "paid"
  | "shipped"
  | "completed"
  | "cancelled";

export interface TrackingStepInfo {
  key: "payment" | "processing" | "shipping" | "completed";
  stepNumber: string;
  title: string;
  statusLabel: string;
  detail: string;
  state: "done" | "current" | "upcoming" | "cancelled";
}

export function isOrderPaid(order: StoreOrder): boolean {
  if (order.payment) {
    return order.payment.status === "paid";
  }
  return (
    order.status === "confirmed" ||
    order.status === "shipped" ||
    order.status === "completed"
  );
}

export function isOrderShipped(order: StoreOrder): boolean {
  return order.status === "shipped" || order.status === "completed";
}

export function isOrderCompleted(order: StoreOrder): boolean {
  return order.status === "completed";
}

export function getPaymentBadge(order: StoreOrder): OrderBadgeInfo {
  const pay = order.payment;
  if (pay) {
    if (pay.status === "paid") {
      return {
        label: "Sudah Dibayar",
        shortLabel: "Sudah Dibayar",
        tone: "emerald",
      };
    }
    if (pay.status === "pending") {
      return {
        label: "Belum Dibayar",
        shortLabel: "Belum Dibayar",
        tone: order.status === "cancelled" ? "neutral" : "rose",
      };
    }
    if (pay.status === "expired") {
      return {
        label: "Pembayaran Kedaluwarsa",
        shortLabel: "Kedaluwarsa",
        tone: "neutral",
      };
    }
    if (pay.status === "cancelled") {
      return {
        label: "Pembayaran Dibatalkan",
        shortLabel: "Batal Bayar",
        tone: "neutral",
      };
    }
    if (pay.status === "failed") {
      return {
        label: "Pembayaran Gagal",
        shortLabel: "Gagal Bayar",
        tone: "rose",
      };
    }
    if (pay.status === "refunded") {
      return {
        label: "Dana Dikembalikan",
        shortLabel: "Refunded",
        tone: "neutral",
      };
    }
  }

  if (
    order.status === "confirmed" ||
    order.status === "shipped" ||
    order.status === "completed"
  ) {
    return {
      label: "Sudah Dibayar",
      shortLabel: "Sudah Dibayar",
      tone: "emerald",
    };
  }
  return {
    label: "Belum Dibayar",
    shortLabel: "Belum Dibayar",
    tone: order.status === "cancelled" ? "neutral" : "rose",
  };
}

export function getFulfillmentBadge(order: StoreOrder): OrderBadgeInfo {
  if (order.status === "cancelled") {
    return {
      label: "Dibatalkan",
      shortLabel: "Dibatalkan",
      tone: "rose",
    };
  }
  if (order.status === "completed") {
    return {
      label: "Pesanan Selesai",
      shortLabel: "Sudah Selesai",
      tone: "emerald",
    };
  }
  if (order.status === "shipped") {
    return {
      label: "Sudah Dikirim",
      shortLabel: "Sudah Dikirim",
      tone: "dark",
    };
  }
  if (order.status === "confirmed" || isOrderPaid(order)) {
    return {
      label: "Diproses · Belum Dikirim",
      shortLabel: "Belum Dikirim",
      tone: "outline",
    };
  }
  return {
    label: "Menunggu Pembayaran",
    shortLabel: "Belum Dikirim",
    tone: "neutral",
  };
}

export function getOrderFilterBucket(
  order: StoreOrder
): Exclude<OrderFilterBucket, "all"> {
  if (order.status === "cancelled") return "cancelled";
  if (order.status === "completed") return "completed";
  if (order.status === "shipped") return "shipped";
  if (order.status === "confirmed" || isOrderPaid(order)) return "paid";
  return "unpaid";
}

export function badgeToneClasses(tone: BadgeTone): string {
  switch (tone) {
    case "emerald":
      return "bg-emerald-950 text-emerald-100";
    case "dark":
      return "bg-[#181817] text-white";
    case "rose":
      return "border border-[#881337] bg-[#FFF1F2] text-[#881337]";
    case "outline":
      return "border border-[#181817] bg-white text-[#181817]";
    case "neutral":
    default:
      return "border border-[#E5E3DC] bg-[#F5F5F5] text-[#57534E]";
  }
}

export function formatOrderTimestamp(ts?: number | string | null): string | null {
  if (!ts) return null;
  const date = typeof ts === "number" ? new Date(ts) : new Date(ts);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function getOrderStatusLabel(status: OrderStatus): string {
  switch (status) {
    case "pending":
      return "Pending (Belum Dibayar)";
    case "confirmed":
      return "Confirmed (Diproses / Belum Dikirim)";
    case "shipped":
      return "Shipped (Sudah Dikirim)";
    case "completed":
      return "Completed (Sudah Selesai)";
    case "cancelled":
      return "Cancelled (Dibatalkan)";
  }
}

export function getOrderTrackingSteps(order: StoreOrder): TrackingStepInfo[] {
  const paid = isOrderPaid(order);
  const shipped = isOrderShipped(order);
  const completed = isOrderCompleted(order);
  const cancelled = order.status === "cancelled";
  const payment = order.payment ?? null;

  const paymentDetail = paid
    ? payment
      ? `Terverifikasi via ${payment.channel}`
      : "Pembayaran dikonfirmasi"
    : payment
    ? `Selesaikan via ${payment.channel}`
    : "Menunggu konfirmasi pembayaran";

  const shippingDetail = shipped
    ? order.shippingCourier || order.trackingNumber
      ? `${order.shippingCourier || "Kurir"}${
          order.trackingNumber ? ` · Resi ${order.trackingNumber}` : ""
        }`
      : order.shippedAt
      ? `Dikirim ${formatOrderTimestamp(order.shippedAt)}`
      : "Paket telah diserahkan ke kurir"
    : "Pesanan belum dikirim";

  const completedDetail = completed
    ? order.completedAt
      ? `Selesai ${formatOrderTimestamp(order.completedAt)}`
      : "Pesanan telah diterima & selesai"
    : "Menunggu konfirmasi selesai";

  return [
    {
      key: "payment",
      stepNumber: "01",
      title: "Pembayaran",
      statusLabel: paid ? "Sudah Dibayar" : "Belum Dibayar",
      detail: paymentDetail,
      state: cancelled ? "cancelled" : paid ? "done" : "current",
    },
    {
      key: "processing",
      stepNumber: "02",
      title: "Proses",
      statusLabel: shipped
        ? "Selesai Dikemas"
        : paid || order.status === "confirmed"
        ? "Sedang Diproses"
        : "Menunggu Proses",
      detail: shipped
        ? "Paket siap & dikirim"
        : paid || order.status === "confirmed"
        ? "Pesanan dikonfirmasi & dikemas"
        : "Menunggu pembayaran",
      state: cancelled
        ? "cancelled"
        : shipped
        ? "done"
        : paid || order.status === "confirmed"
        ? "current"
        : "upcoming",
    },
    {
      key: "shipping",
      stepNumber: "03",
      title: "Pengiriman",
      statusLabel: shipped ? "Sudah Dikirim" : "Belum Dikirim",
      detail: shippingDetail,
      state: cancelled
        ? "cancelled"
        : completed
        ? "done"
        : shipped
        ? "current"
        : "upcoming",
    },
    {
      key: "completed",
      stepNumber: "04",
      title: "Selesai",
      statusLabel: completed ? "Sudah Selesai" : "Belum Selesai",
      detail: completedDetail,
      state: cancelled ? "cancelled" : completed ? "done" : "upcoming",
    },
  ];
}
