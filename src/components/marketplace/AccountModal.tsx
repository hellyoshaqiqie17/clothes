"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { formatIDR } from "@/data/catalogProducts";
import {
  badgeToneClasses,
  formatOrderTimestamp,
  getFulfillmentBadge,
  getOrderFilterBucket,
  getOrderTrackingSteps,
  getPaymentBadge,
  isOrderShipped,
  type OrderFilterBucket,
} from "@/lib/orderStatus";
import type {
  BagItem,
  MemberProfile,
  StoreOrder,
  StoreSettings,
} from "@/types/catalog";

interface AccountModalProps {
  open: boolean;
  initialMode?: "login" | "register";
  member: MemberProfile | null;
  settings: StoreSettings;
  bagItems: BagItem[];
  wishlistIds: string[];
  onAuthSuccess: (data: {
    member: MemberProfile;
    bagItems: BagItem[];
    wishlistIds: string[];
  }) => void;
  onProfileUpdated: (member: MemberProfile) => void;
  onLogout: () => void;
  onOpenBag: () => void;
  onOpenWishlist: () => void;
  onTrackOrder: (orderId: string) => void;
  onClose: () => void;
}

export default function AccountModal({
  open,
  initialMode = "login",
  member,
  settings,
  bagItems,
  wishlistIds,
  onAuthSuccess,
  onProfileUpdated,
  onLogout,
  onOpenBag,
  onOpenWishlist,
  onTrackOrder,
  onClose,
}: AccountModalProps) {
  const [authTab, setAuthTab] = useState<"login" | "register">(initialMode);
  const [memberTab, setMemberTab] = useState<"orders" | "saved" | "profile">(
    "orders"
  );

  // Guest form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Logged-in orders state
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);
  const [orderFilter, setOrderFilter] = useState<OrderFilterBucket>("all");
  const [copiedResiId, setCopiedResiId] = useState<string | null>(null);

  const orderCounts = useMemo(() => {
    const counts: Record<OrderFilterBucket, number> = {
      all: orders.length,
      unpaid: 0,
      paid: 0,
      shipped: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const ord of orders) {
      counts[getOrderFilterBucket(ord)] += 1;
    }
    return counts;
  }, [orders]);

  const visibleOrders = useMemo(() => {
    if (orderFilter === "all") return orders;
    return orders.filter((ord) => getOrderFilterBucket(ord) === orderFilter);
  }, [orders, orderFilter]);

  const handleCopyResi = async (orderId: string, resi: string) => {
    try {
      await navigator.clipboard.writeText(resi);
      setCopiedResiId(orderId);
      window.setTimeout(() => {
        setCopiedResiId((cur) => (cur === orderId ? null : cur));
      }, 2000);
    } catch {
      // clipboard unavailable
    }
  };

  // Profile edit state
  const [profName, setProfName] = useState(member?.name ?? "");
  const [profPhone, setProfPhone] = useState(member?.phone ?? "");
  const [profAddress, setProfAddress] = useState(member?.defaultAddress ?? "");
  const [profCity, setProfCity] = useState(member?.defaultCity ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileSavedMsg, setProfileSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const loadMemberOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      const res = await fetch("/api/member/orders", { cache: "no-store" });
      const data = (await res.json()) as {
        orders?: StoreOrder[];
        member?: MemberProfile;
        error?: string;
      };
      if (!res.ok) {
        setOrdersError(data.error || "Gagal memuat riwayat pembelian.");
        return;
      }
      setOrders(data.orders ?? []);
      if (data.member) onProfileUpdated(data.member);
    } catch {
      setOrdersError("Gagal menghubungi server untuk memuat riwayat order.");
    } finally {
      setOrdersLoading(false);
    }
  }, [onProfileUpdated]);

  useEffect(() => {
    if (!open || !member) return;
    const timer = window.setTimeout(() => {
      setProfName(member.name);
      setProfPhone(member.phone);
      setProfAddress(member.defaultAddress);
      setProfCity(member.defaultCity);
      void loadMemberOrders();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [open, member?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const endpoint =
        authTab === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload =
        authTab === "register"
          ? { name, email, phone, password, bagItems, wishlistIds }
          : { email, password, bagItems, wishlistIds };

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        member?: MemberProfile;
        bagItems?: BagItem[];
        wishlistIds?: string[];
        error?: string;
      };
      if (!res.ok || !data.member) {
        setErrorMsg(data.error || "Autentikasi gagal. Periksa kembali data Anda.");
        return;
      }
      setPassword("");
      onAuthSuccess({
        member: data.member,
        bagItems: data.bagItems ?? bagItems,
        wishlistIds: data.wishlistIds ?? wishlistIds,
      });
    } catch {
      setErrorMsg("Gangguan jaringan. Silakan coba beberapa saat lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingProfile(true);
    setProfileSavedMsg(null);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: profName,
          phone: profPhone,
          defaultAddress: profAddress,
          defaultCity: profCity,
        }),
      });
      const data = (await res.json()) as {
        member?: MemberProfile;
        error?: string;
      };
      if (!res.ok || !data.member) {
        setErrorMsg(data.error || "Gagal menyimpan profil.");
        return;
      }
      onProfileUpdated(data.member);
      setProfileSavedMsg("Profil dan alamat pengiriman berhasil disimpan.");
    } catch {
      setErrorMsg("Gangguan jaringan saat menyimpan profil.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogoutClick = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      // clear locally anyway
    }
    onLogout();
    onClose();
  };

  const showPromoBanner =
    settings.newMemberDiscountEnabled && settings.newMemberDiscountPercent > 0;
  const promoScopeSummary =
    settings.newMemberDiscountScope === "tags" &&
    settings.newMemberDiscountTags.length > 0
      ? `berlaku untuk produk bertag ${settings.newMemberDiscountTags
          .map((t) => `#${t}`)
          .join(", ")}`
      : "berlaku global untuk seluruh produk";

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="member-account-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90dvh] w-full max-w-xl flex-col overflow-hidden bg-white text-[#181817] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#E5E3DC] px-6 py-4">
          <div>
            <h2
              id="member-account-title"
              className="font-display text-xl font-medium tracking-tight text-[#181817]"
            >
              {member ? `Hi, ${member.name}` : "Member Account"}
            </h2>
            {member && (
              <p className="mt-0.5 text-[11px] text-[#57534E]">
                {member.email} · {member.orderCount} order(s)
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close account modal"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] text-base font-medium text-[#181817] hover:bg-[#F5F5F5]"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-5">
          {!member ? (
            <div className="space-y-5">
              {showPromoBanner && (
                <div className="border border-[#181817] bg-[#FAFAFA] p-4 text-xs">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#881337]">
                    New Member Benefit
                  </p>
                  <p className="mt-1 font-medium text-[#181817]">
                    Daftar member gratis &amp; nikmati diskon{" "}
                    <strong className="font-semibold">
                      {settings.newMemberDiscountPercent}%
                    </strong>{" "}
                    ({promoScopeSummary}), simpan keranjang lintas perangkat,
                    dan pantau riwayat pembelian.
                  </p>
                </div>
              )}

              {/* Mode Switch Tabs */}
              <div className="grid grid-cols-2 border border-[#E5E3DC]">
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab("login");
                    setErrorMsg(null);
                  }}
                  className={`min-h-[44px] text-xs font-medium transition-colors ${
                    authTab === "login"
                      ? "bg-[#181817] text-white"
                      : "bg-white text-[#57534E] hover:text-[#181817]"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthTab("register");
                    setErrorMsg(null);
                  }}
                  className={`min-h-[44px] text-xs font-medium transition-colors ${
                    authTab === "register"
                      ? "bg-[#181817] text-white"
                      : "bg-white text-[#57534E] hover:text-[#181817]"
                  }`}
                >
                  Create Member Account
                </button>
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="border border-[#881337] bg-[#FFF1F2] p-3 text-xs text-[#881337]"
                >
                  {errorMsg}
                </div>
              )}

              <form onSubmit={(e) => void handleAuthSubmit(e)} className="space-y-3.5">
                {authTab === "register" && (
                  <>
                    <div>
                      <label
                        htmlFor="member-name"
                        className="block text-xs font-medium text-[#181817]"
                      >
                        Full Name *
                      </label>
                      <input
                        id="member-name"
                        type="text"
                        required
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Raka Pratama"
                        className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="member-phone"
                        className="block text-xs font-medium text-[#181817]"
                      >
                        Phone / WhatsApp
                      </label>
                      <input
                        id="member-phone"
                        type="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="0812 3456 7890"
                        className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label
                    htmlFor="member-email"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    {authTab === "login" ? "Email / Username *" : "Email *"}
                  </label>
                  <input
                    id="member-email"
                    type={authTab === "login" ? "text" : "email"}
                    required
                    autoComplete={authTab === "login" ? "username" : "email"}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={
                      authTab === "login"
                        ? "you@domain.com atau admin"
                        : "you@domain.com"
                    }
                    className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="member-password"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Password *
                  </label>
                  <input
                    id="member-password"
                    type="password"
                    required
                    minLength={6}
                    autoComplete={
                      authTab === "register" ? "new-password" : "current-password"
                    }
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={
                      authTab === "register"
                        ? "Minimal 6 karakter"
                        : "Masukkan password Anda"
                    }
                    className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="min-h-[48px] w-full bg-[#181817] px-4 text-xs font-medium tracking-wide text-white transition-colors hover:bg-[#333330] disabled:opacity-60"
                >
                  {submitting
                    ? "Processing..."
                    : authTab === "register"
                    ? "Create Member Account"
                    : "Sign In"}
                </button>
              </form>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Admin Quick Access Banner (visible ONLY for role === 'admin') */}
              {member.role === "admin" && (
                <div className="flex flex-wrap items-center justify-between gap-3 border border-[#181817] bg-[#181817] p-4 text-xs text-white">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/75">
                      Admin Account
                    </p>
                    <p className="mt-0.5 text-white">
                      Masuk ke Admin Dashboard untuk kelola produk, pengiriman,
                      voucher, dan pengaturan toko.
                    </p>
                  </div>
                  <Link
                    href="/admin"
                    onClick={onClose}
                    className="inline-flex min-h-[40px] shrink-0 items-center bg-white px-4 text-xs font-semibold text-[#181817] transition-colors hover:bg-[#EFEFEB]"
                  >
                    Buka Admin Dashboard →
                  </Link>
                </div>
              )}

              {/* Active Member Promo Pill */}
              {member.newMemberEligible && showPromoBanner && (
                <div className="flex items-start justify-between gap-3 border border-[#181817] bg-[#FAFAFA] p-3.5 text-xs">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#881337]">
                      Diskon Member Aktif
                    </p>
                    <p className="mt-0.5 text-[#181817]">
                      Anda berhak mendapat potongan{" "}
                      <strong>{settings.newMemberDiscountPercent}%</strong>{" "}
                      otomatis saat checkout ({promoScopeSummary}).
                    </p>
                  </div>
                </div>
              )}

              {/* Member Navigation Tabs */}
              <div className="flex flex-wrap gap-2 border-b border-[#E5E3DC] pb-3">
                {(
                  [
                    { id: "orders", label: `Purchase History (${orders.length})` },
                    {
                      id: "saved",
                      label: `Saved Bag (${bagItems.reduce((s, i) => s + i.quantity, 0)})`,
                    },
                    { id: "profile", label: "Profile & Shipping" },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setMemberTab(t.id);
                      if (t.id === "orders") void loadMemberOrders();
                    }}
                    className={`min-h-[40px] border px-3.5 text-xs font-medium transition-colors ${
                      memberTab === t.id
                        ? "border-[#181817] bg-[#181817] text-white"
                        : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {/* TAB 1: PURCHASE HISTORY */}
              {memberTab === "orders" && (
                <div className="space-y-3">
                  {orders.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        {(
                          [
                            { id: "all", label: "Semua" },
                            { id: "unpaid", label: "Belum Dibayar" },
                            { id: "paid", label: "Diproses" },
                            { id: "shipped", label: "Dikirim" },
                            { id: "completed", label: "Selesai" },
                            ...(orderCounts.cancelled > 0
                              ? ([{ id: "cancelled", label: "Dibatalkan" }] as const)
                              : []),
                          ] as const
                        ).map((pill) => (
                          <button
                            key={pill.id}
                            type="button"
                            onClick={() => setOrderFilter(pill.id)}
                            aria-pressed={orderFilter === pill.id}
                            className={`min-h-[34px] border px-2.5 text-[11px] font-medium transition-colors ${
                              orderFilter === pill.id
                                ? "border-[#181817] bg-[#181817] text-white"
                                : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                            }`}
                          >
                            {pill.label}{" "}
                            <span className="tabular-nums opacity-75">
                              ({orderCounts[pill.id]})
                            </span>
                          </button>
                        ))}
                      </div>
                      <button
                        type="button"
                        disabled={ordersLoading}
                        onClick={() => void loadMemberOrders()}
                        className="min-h-[34px] border border-[#E5E3DC] bg-white px-2.5 text-[11px] font-medium text-[#181817] hover:border-[#181817] disabled:opacity-50"
                      >
                        {ordersLoading ? "Memuat..." : "Refresh Status"}
                      </button>
                    </div>
                  )}

                  {ordersLoading && orders.length === 0 ? (
                    <p className="py-6 text-center text-xs text-[#57534E]">
                      Loading purchase history...
                    </p>
                  ) : ordersError ? (
                    <div
                      role="alert"
                      className="border border-[#881337] bg-[#FFF1F2] p-3 text-xs text-[#881337]"
                    >
                      {ordersError}
                    </div>
                  ) : orders.length === 0 ? (
                    <div className="border border-[#E5E3DC] bg-[#FAFAFA] p-8 text-center text-xs text-[#57534E]">
                      <p className="font-semibold text-[#181817]">
                        Belum ada riwayat pembelian
                      </p>
                      <p className="mt-1">
                        Pesanan Anda akan tersimpan otomatis di sini begitu
                        checkout dilakukan.
                      </p>
                    </div>
                  ) : visibleOrders.length === 0 ? (
                    <div className="border border-[#E5E3DC] bg-[#FAFAFA] p-6 text-center text-xs text-[#57534E]">
                      Tidak ada pesanan dengan status ini.
                    </div>
                  ) : (
                    <div className="divide-y divide-[#E5E3DC] border border-[#E5E3DC]">
                      {visibleOrders.map((ord) => {
                        const payBadge = getPaymentBadge(ord);
                        const fulfillmentBadge = getFulfillmentBadge(ord);
                        const steps = getOrderTrackingSteps(ord);
                        const shipped = isOrderShipped(ord);
                        const shippedAtLabel = formatOrderTimestamp(ord.shippedAt);
                        const completedAtLabel = formatOrderTimestamp(ord.completedAt);

                        return (
                          <div key={ord.id} className="space-y-3 p-4 text-xs">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <span className="font-mono font-semibold text-[#181817]">
                                  {ord.id}
                                </span>
                                <span className="ml-2 text-[11px] tabular-nums text-[#57534E]">
                                  {new Date(ord.createdAt).toLocaleString(
                                    "id-ID",
                                    {
                                      dateStyle: "medium",
                                      timeStyle: "short",
                                    }
                                  )}
                                </span>
                              </div>
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badgeToneClasses(
                                    payBadge.tone
                                  )}`}
                                >
                                  {payBadge.shortLabel}
                                </span>
                                <span
                                  className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${badgeToneClasses(
                                    fulfillmentBadge.tone
                                  )}`}
                                >
                                  {fulfillmentBadge.shortLabel}
                                </span>
                              </div>
                            </div>

                            {/* Inline 4-Step Live Progress Bar */}
                            {ord.status === "cancelled" ? (
                              <div className="border border-[#881337] bg-[#FFF1F2] px-3 py-2 text-[11px] text-[#881337]">
                                Pesanan ini telah dibatalkan.
                              </div>
                            ) : (
                              <ol className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                                {steps.map((step) => {
                                  const isDone = step.state === "done";
                                  const isCurrent = step.state === "current";
                                  return (
                                    <li
                                      key={step.key}
                                      className={`border px-2.5 py-2 ${
                                        isDone
                                          ? "border-[#181817] bg-[#181817] text-white"
                                          : isCurrent
                                          ? "border-[#181817] bg-[#FAFAFA] text-[#181817]"
                                          : "border-[#E5E3DC] bg-white text-[#57534E] opacity-60"
                                      }`}
                                    >
                                      <p
                                        className={`text-[9px] font-semibold uppercase tracking-wider ${
                                          isDone
                                            ? "text-white/75"
                                            : "text-[#57534E]"
                                        }`}
                                      >
                                        {step.stepNumber} · {step.title}
                                      </p>
                                      <p className="mt-0.5 text-[11px] font-semibold leading-tight">
                                        {step.statusLabel}
                                      </p>
                                    </li>
                                  );
                                })}
                              </ol>
                            )}

                            {/* Courier, Resi & Timestamps */}
                            {(shipped ||
                              ord.shippingCourier ||
                              ord.trackingNumber) && (
                              <div className="flex flex-wrap items-center justify-between gap-2 border border-[#E5E3DC] bg-[#FAFAFA] px-3 py-2 text-[11px]">
                                <div className="space-y-0.5">
                                  <p className="font-medium text-[#181817]">
                                    {ord.shippingCourier
                                      ? `Kurir: ${ord.shippingCourier}`
                                      : "Pengiriman"}
                                    {ord.trackingNumber && (
                                      <>
                                        {" "}
                                        · Resi{" "}
                                        <span className="font-mono font-semibold">
                                          {ord.trackingNumber}
                                        </span>
                                      </>
                                    )}
                                  </p>
                                  <p className="text-[10px] tabular-nums text-[#57534E]">
                                    {shippedAtLabel && (
                                      <span>Dikirim: {shippedAtLabel}</span>
                                    )}
                                    {shippedAtLabel && completedAtLabel && " · "}
                                    {completedAtLabel && (
                                      <span className="font-medium text-emerald-800">
                                        Selesai: {completedAtLabel}
                                      </span>
                                    )}
                                  </p>
                                </div>
                                {ord.trackingNumber && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleCopyResi(
                                        ord.id,
                                        ord.trackingNumber || ""
                                      )
                                    }
                                    className="min-h-[32px] border border-[#181817] bg-white px-2.5 text-[10px] font-medium text-[#181817] hover:bg-[#181817] hover:text-white"
                                  >
                                    {copiedResiId === ord.id
                                      ? "Tersalin"
                                      : "Salin Resi"}
                                  </button>
                                )}
                              </div>
                            )}

                            <ul className="space-y-0.5 text-[11px] text-[#57534E]">
                              {ord.items.map((item) => (
                                <li key={item.key}>
                                  {item.quantity}x {item.title} (Size{" "}
                                  {item.size})
                                </li>
                              ))}
                            </ul>

                            {((ord.memberDiscount ?? 0) > 0 ||
                              (ord.voucherDiscount ?? 0) > 0) && (
                              <div className="flex flex-wrap gap-1.5 text-[10px]">
                                {(ord.memberDiscount ?? 0) > 0 && (
                                  <span className="border border-[#E5E3DC] bg-[#FAFAFA] px-2 py-0.5 font-medium text-[#181817]">
                                    Member -{formatIDR(ord.memberDiscount ?? 0)}
                                  </span>
                                )}
                                {(ord.voucherDiscount ?? 0) > 0 && (
                                  <span className="border border-[#E5E3DC] bg-[#FAFAFA] px-2 py-0.5 font-medium text-[#881337]">
                                    Voucher {ord.voucherCode} -
                                    {formatIDR(ord.voucherDiscount ?? 0)}
                                  </span>
                                )}
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E5E3DC] pt-2">
                              <p className="font-semibold tabular-nums text-[#181817]">
                                Total {formatIDR(ord.total)}
                              </p>
                              <button
                                type="button"
                                onClick={() => {
                                  onClose();
                                  onTrackOrder(ord.id);
                                }}
                                className="min-h-[36px] border border-[#181817] bg-white px-3 text-[11px] font-medium text-[#181817] hover:bg-[#181817] hover:text-white"
                              >
                                {ord.payment?.status === "pending"
                                  ? "Lanjutkan Pembayaran"
                                  : "Lacak & Detail Pesanan"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: SAVED BAG & WISHLIST */}
              {memberTab === "saved" && (
                <div className="space-y-4 text-xs">
                  <div className="border border-[#E5E3DC] bg-[#FAFAFA] p-4">
                    <p className="font-semibold text-[#181817]">
                      Keranjang Tersimpan di Akun Member
                    </p>
                    <p className="mt-1 text-[#57534E]">
                      Semua item di Bag ({bagItems.reduce((s, i) => s + i.quantity, 0)} item) dan Wishlist ({wishlistIds.length} produk) otomatis tersimpan di akun{" "}
                      <strong className="text-[#181817]">{member.email}</strong>{" "}
                      sehingga bisa dilanjutkan dari perangkat mana saja.
                    </p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenBag();
                        }}
                        className="min-h-[42px] bg-[#181817] px-4 text-xs font-medium text-white hover:bg-[#333330]"
                      >
                        Buka Shopping Bag
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          onClose();
                          onOpenWishlist();
                        }}
                        className="min-h-[42px] border border-[#181817] bg-white px-4 text-xs font-medium text-[#181817] hover:bg-[#F5F5F5]"
                      >
                        Buka Wishlist ({wishlistIds.length})
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: PROFILE & SHIPPING */}
              {memberTab === "profile" && (
                <form
                  onSubmit={(e) => void handleSaveProfile(e)}
                  className="space-y-3.5 text-xs"
                >
                  {profileSavedMsg && (
                    <div
                      role="status"
                      className="border border-[#181817] bg-[#FAFAFA] p-3 text-xs text-[#181817]"
                    >
                      {profileSavedMsg}
                    </div>
                  )}
                  {errorMsg && (
                    <div
                      role="alert"
                      className="border border-[#881337] bg-[#FFF1F2] p-3 text-xs text-[#881337]"
                    >
                      {errorMsg}
                    </div>
                  )}

                  <div>
                    <label
                      htmlFor="prof-name"
                      className="block text-xs font-medium text-[#181817]"
                    >
                      Full Name
                    </label>
                    <input
                      id="prof-name"
                      type="text"
                      required
                      value={profName}
                      onChange={(e) => setProfName(e.target.value)}
                      className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="prof-phone"
                      className="block text-xs font-medium text-[#181817]"
                    >
                      Phone / WhatsApp
                    </label>
                    <input
                      id="prof-phone"
                      type="tel"
                      value={profPhone}
                      onChange={(e) => setProfPhone(e.target.value)}
                      className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="prof-address"
                      className="block text-xs font-medium text-[#181817]"
                    >
                      Default Street Address
                    </label>
                    <textarea
                      id="prof-address"
                      rows={2}
                      value={profAddress}
                      onChange={(e) => setProfAddress(e.target.value)}
                      placeholder="Auto-filled during checkout"
                      className="mt-1 w-full border border-[#E5E3DC] bg-white p-3 text-xs text-[#181817]"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="prof-city"
                      className="block text-xs font-medium text-[#181817]"
                    >
                      Default City / Province
                    </label>
                    <input
                      id="prof-city"
                      type="text"
                      value={profCity}
                      onChange={(e) => setProfCity(e.target.value)}
                      className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={savingProfile}
                      className="min-h-[44px] bg-[#181817] px-5 text-xs font-medium text-white hover:bg-[#333330] disabled:opacity-60"
                    >
                      {savingProfile ? "Saving..." : "Save Profile"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleLogoutClick()}
                      className="min-h-[44px] border border-[#E5E3DC] bg-white px-4 text-xs font-medium text-[#881337] hover:border-[#881337]"
                    >
                      Sign Out
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
