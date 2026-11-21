"use client";

import { useMemo, useState } from "react";
import {
  formatIDR,
  normalizeProductTag,
} from "@/data/catalogProducts";
import type {
  CatalogProduct,
  PromoScope,
  StoreSettings,
  Voucher,
  VoucherDiscountType,
} from "@/types/catalog";

interface AdminPromosPanelProps {
  settings: StoreSettings;
  products: CatalogProduct[];
  vouchers: Voucher[];
  onSettingsUpdated: (settings: StoreSettings) => void;
  onProductsUpdated: (products: CatalogProduct[]) => void;
  onVouchersUpdated: (vouchers: Voucher[]) => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}

interface VoucherFormState {
  id: string | null;
  code: string;
  description: string;
  discountType: VoucherDiscountType;
  discountValue: string;
  maxDiscount: string;
  minSubtotal: string;
  scope: PromoScope;
  tags: string[];
  usageLimit: string;
  expiresAt: string;
  isActive: boolean;
}

const EMPTY_VOUCHER_FORM: VoucherFormState = {
  id: null,
  code: "",
  description: "",
  discountType: "percent",
  discountValue: "10",
  maxDiscount: "150000",
  minSubtotal: "0",
  scope: "global",
  tags: [],
  usageLimit: "",
  expiresAt: "",
  isActive: true,
};

export default function AdminPromosPanel({
  settings,
  products,
  vouchers,
  onSettingsUpdated,
  onProductsUpdated,
  onVouchersUpdated,
  onFlash,
  onError,
}: AdminPromosPanelProps) {
  // Member Discount local editor state
  const [memberEnabled, setMemberEnabled] = useState(
    settings.newMemberDiscountEnabled
  );
  const [memberPercent, setMemberPercent] = useState(
    String(settings.newMemberDiscountPercent)
  );
  const [memberMaxOrders, setMemberMaxOrders] = useState(
    String(settings.newMemberDiscountMaxOrders)
  );
  const [memberStackable, setMemberStackable] = useState(
    settings.newMemberDiscountStackable
  );
  const [memberScope, setMemberScope] = useState<PromoScope>(
    settings.newMemberDiscountScope
  );
  const [memberTags, setMemberTags] = useState<string[]>(
    settings.newMemberDiscountTags
  );
  const [memberTagInput, setMemberTagInput] = useState("");
  const [savingMemberPromo, setSavingMemberPromo] = useState(false);

  // Quick Product Tag Assignment helper
  const [assignTag, setAssignTag] = useState(
    () => settings.newMemberDiscountTags[0] || "new-member"
  );
  const [togglingProductId, setTogglingProductId] = useState<string | null>(
    null
  );

  // Voucher CRUD state
  const [form, setForm] = useState<VoucherFormState>(EMPTY_VOUCHER_FORM);
  const [voucherTagInput, setVoucherTagInput] = useState("");
  const [savingVoucher, setSavingVoucher] = useState(false);
  const [confirmDeleteVoucherId, setConfirmDeleteVoucherId] = useState<
    string | null
  >(null);

  const allExistingTags = useMemo(() => {
    const set = new Set<string>(["new-member", "member-promo", "essentials"]);
    for (const p of products) {
      for (const t of p.tags ?? []) set.add(t);
    }
    for (const t of memberTags) set.add(t);
    for (const v of vouchers) {
      for (const t of v.tags) set.add(t);
    }
    return Array.from(set).sort();
  }, [products, memberTags, vouchers]);

  const handleSaveMemberPromo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (memberScope === "tags" && memberTags.length === 0) {
      onError(
        "Tambahkan minimal 1 tag produk untuk diskon member bertag, atau pilih mode Global."
      );
      return;
    }
    setSavingMemberPromo(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newMemberDiscountEnabled: memberEnabled,
          newMemberDiscountPercent: Math.max(
            0,
            Math.min(90, Number(memberPercent) || 0)
          ),
          newMemberDiscountScope: memberScope,
          newMemberDiscountTags: memberScope === "tags" ? memberTags : [],
          newMemberDiscountMaxOrders: Math.max(
            0,
            Number(memberMaxOrders) || 0
          ),
          newMemberDiscountStackable: memberStackable,
        }),
      });
      const data = (await res.json()) as {
        settings?: StoreSettings;
        error?: string;
      };
      if (!res.ok || !data.settings) {
        throw new Error(data.error || "Gagal menyimpan aturan diskon member.");
      }
      onSettingsUpdated(data.settings);
      onFlash("Pengaturan diskon member baru berhasil disimpan ke D1.");
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Gagal menyimpan diskon member."
      );
    } finally {
      setSavingMemberPromo(false);
    }
  };

  const handleToggleProductTag = async (
    product: CatalogProduct,
    rawTag: string
  ) => {
    const clean = normalizeProductTag(rawTag);
    if (!clean) return;
    setTogglingProductId(product.id);
    const currentTags = product.tags ?? [];
    const nextTags = currentTags.includes(clean)
      ? currentTags.filter((t) => t !== clean)
      : [...currentTags, clean];

    try {
      const res = await fetch(`/api/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags: nextTags }),
      });
      const data = (await res.json()) as {
        product?: CatalogProduct;
        error?: string;
      };
      if (!res.ok || !data.product) {
        throw new Error(data.error || "Gagal memperbarui tag produk.");
      }
      onProductsUpdated(
        products.map((p) => (p.id === product.id ? data.product! : p))
      );
      onFlash(
        nextTags.includes(clean)
          ? `Tag #${clean} ditambahkan ke "${product.title}".`
          : `Tag #${clean} dihapus dari "${product.title}".`
      );
    } catch (err) {
      onError(
        err instanceof Error ? err.message : "Gagal memperbarui tag produk."
      );
    } finally {
      setTogglingProductId(null);
    }
  };

  const handleVoucherSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingVoucher(true);
    try {
      const payload = {
        code: form.code.trim().toUpperCase(),
        description: form.description.trim(),
        discountType: form.discountType,
        discountValue: Number(form.discountValue) || 0,
        maxDiscount:
          form.discountType === "percent" && form.maxDiscount.trim()
            ? Number(form.maxDiscount)
            : null,
        minSubtotal: Number(form.minSubtotal) || 0,
        scope: form.scope,
        tags: form.scope === "tags" ? form.tags : [],
        usageLimit: form.usageLimit.trim() ? Number(form.usageLimit) : null,
        expiresAt: form.expiresAt.trim()
          ? new Date(form.expiresAt).toISOString()
          : null,
        isActive: form.isActive,
      };

      const isEdit = Boolean(form.id);
      const res = await fetch(
        isEdit ? `/api/vouchers/${encodeURIComponent(form.id!)}` : "/api/vouchers",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = (await res.json()) as { voucher?: Voucher; error?: string };
      if (!res.ok || !data.voucher) {
        throw new Error(data.error || "Gagal menyimpan voucher.");
      }

      if (isEdit) {
        onVouchersUpdated(
          vouchers.map((v) => (v.id === data.voucher!.id ? data.voucher! : v))
        );
        onFlash(`Voucher ${data.voucher.code} diperbarui.`);
      } else {
        onVouchersUpdated([data.voucher, ...vouchers]);
        onFlash(`Voucher ${data.voucher.code} berhasil dibuat.`);
      }
      setForm(EMPTY_VOUCHER_FORM);
      setVoucherTagInput("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Gagal menyimpan voucher.");
    } finally {
      setSavingVoucher(false);
    }
  };

  const handleToggleVoucherActive = async (voucher: Voucher) => {
    try {
      const res = await fetch(`/api/vouchers/${encodeURIComponent(voucher.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !voucher.isActive }),
      });
      const data = (await res.json()) as { voucher?: Voucher; error?: string };
      if (!res.ok || !data.voucher) {
        throw new Error(data.error || "Gagal mengubah status voucher.");
      }
      onVouchersUpdated(
        vouchers.map((v) => (v.id === voucher.id ? data.voucher! : v))
      );
      onFlash(
        data.voucher.isActive
          ? `Voucher ${voucher.code} diaktifkan.`
          : `Voucher ${voucher.code} dinonaktifkan.`
      );
    } catch (err) {
      onError(err instanceof Error ? err.message : "Gagal update voucher.");
    }
  };

  const handleDeleteVoucher = async (voucher: Voucher) => {
    try {
      const res = await fetch(`/api/vouchers/${encodeURIComponent(voucher.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Gagal menghapus voucher.");
      onVouchersUpdated(vouchers.filter((v) => v.id !== voucher.id));
      setConfirmDeleteVoucherId(null);
      if (form.id === voucher.id) setForm(EMPTY_VOUCHER_FORM);
      onFlash(`Voucher ${voucher.code} dihapus.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Gagal menghapus voucher.");
    }
  };

  const startEditVoucher = (v: Voucher) => {
    setForm({
      id: v.id,
      code: v.code,
      description: v.description,
      discountType: v.discountType,
      discountValue: String(v.discountValue),
      maxDiscount: v.maxDiscount !== null ? String(v.maxDiscount) : "",
      minSubtotal: String(v.minSubtotal || 0),
      scope: v.scope,
      tags: [...v.tags],
      usageLimit: v.usageLimit !== null ? String(v.usageLimit) : "",
      expiresAt: v.expiresAt ? v.expiresAt.slice(0, 16) : "",
      isActive: v.isActive,
    });
  };

  return (
    <div className="mt-6 space-y-8">
      {/* SECTION 1: NEW MEMBER DISCOUNT & PRODUCT TAG TARGETING */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <form
          onSubmit={(e) => void handleSaveMemberPromo(e)}
          className="space-y-4 border border-[#E5E3DC] bg-white p-6 lg:col-span-7"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E3DC] pb-4">
            <div>
              <h2 className="font-display text-2xl font-normal text-[#181817]">
                New Member Discount Rules
              </h2>
              <p className="mt-0.5 text-xs text-[#57534E]">
                Atur persentase diskon otomatis untuk member baru, apakah berlaku
                global atau hanya produk dengan tag tertentu.
              </p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 border border-[#181817] px-3 py-1.5 text-xs font-medium text-[#181817]">
              <input
                type="checkbox"
                checked={memberEnabled}
                onChange={(e) => setMemberEnabled(e.target.checked)}
                className="h-4 w-4 accent-[#181817]"
              />
              {memberEnabled ? "Active" : "Disabled"}
            </label>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="member-discount-pct"
                className="block text-xs font-medium text-[#181817]"
              >
                Potongan Member (%)
              </label>
              <input
                id="member-discount-pct"
                type="number"
                min="0"
                max="90"
                value={memberPercent}
                onChange={(e) => setMemberPercent(e.target.value)}
                className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
              />
            </div>

            <div>
              <label
                htmlFor="member-max-orders"
                className="block text-xs font-medium text-[#181817]"
              >
                Berlaku Untuk
              </label>
              <select
                id="member-max-orders"
                value={memberMaxOrders}
                onChange={(e) => setMemberMaxOrders(e.target.value)}
                className="mt-1 h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
              >
                <option value="1">Order pertama member baru (1x)</option>
                <option value="2">2 order pertama member baru</option>
                <option value="3">3 order pertama member baru</option>
                <option value="0">Semua order member (tanpa batas)</option>
              </select>
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-[#181817]">
              Cakupan Produk Diskon Member
            </span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMemberScope("global")}
                aria-pressed={memberScope === "global"}
                className={`min-h-[44px] border px-3 text-xs font-medium transition-colors ${
                  memberScope === "global"
                    ? "border-[#181817] bg-[#181817] text-white"
                    : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                }`}
              >
                Global (Semua Produk)
              </button>
              <button
                type="button"
                onClick={() => setMemberScope("tags")}
                aria-pressed={memberScope === "tags"}
                className={`min-h-[44px] border px-3 text-xs font-medium transition-colors ${
                  memberScope === "tags"
                    ? "border-[#181817] bg-[#181817] text-white"
                    : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                }`}
              >
                Khusus Tag Produk
              </button>
            </div>
          </div>

          {memberScope === "tags" && (
            <div className="space-y-2.5 border border-[#E5E3DC] bg-[#FAFAFA] p-4">
              <label
                htmlFor="member-promo-tag-input"
                className="block text-xs font-medium text-[#181817]"
              >
                Tag Produk Eligible Diskon Member
              </label>
              <div className="flex gap-2">
                <input
                  id="member-promo-tag-input"
                  type="text"
                  value={memberTagInput}
                  onChange={(e) => setMemberTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const clean = normalizeProductTag(memberTagInput);
                      if (!clean) return;
                      setMemberTags((prev) =>
                        Array.from(new Set([...prev, clean]))
                      );
                      setAssignTag(clean);
                      setMemberTagInput("");
                    }
                  }}
                  placeholder="Contoh: new-member"
                  className="min-h-[40px] flex-1 border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = normalizeProductTag(memberTagInput);
                    if (!clean) return;
                    setMemberTags((prev) =>
                      Array.from(new Set([...prev, clean]))
                    );
                    setAssignTag(clean);
                    setMemberTagInput("");
                  }}
                  className="min-h-[40px] border border-[#181817] bg-white px-3 text-xs font-medium text-[#181817] hover:bg-[#181817] hover:text-white"
                >
                  + Add Tag
                </button>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {allExistingTags.map((t) => {
                  const selected = memberTags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => {
                        setMemberTags((prev) =>
                          prev.includes(t)
                            ? prev.filter((x) => x !== t)
                            : [...prev, t]
                        );
                        setAssignTag(t);
                      }}
                      className={`border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                        selected
                          ? "border-[#181817] bg-[#181817] text-white"
                          : "border-[#E5E3DC] bg-white text-[#57534E] hover:border-[#181817]"
                      }`}
                    >
                      #{t} {selected ? "✓" : "+"}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-[#181817]">
            <input
              type="checkbox"
              checked={memberStackable}
              onChange={(e) => setMemberStackable(e.target.checked)}
              className="h-4 w-4 accent-[#181817]"
            />
            Boleh digabung (stackable) dengan kode voucher
          </label>

          <button
            type="submit"
            disabled={savingMemberPromo}
            className="min-h-[46px] bg-[#181817] px-5 text-xs font-medium tracking-wide text-white hover:bg-[#333330] disabled:opacity-60"
          >
            {savingMemberPromo
              ? "Saving Member Rules..."
              : "Save Member Discount Rules"}
          </button>
        </form>

        {/* Quick Assign Tag to Products */}
        <div className="space-y-4 border border-[#E5E3DC] bg-white p-6 lg:col-span-5">
          <div className="border-b border-[#E5E3DC] pb-4">
            <h3 className="font-display text-xl font-normal text-[#181817]">
              Assign Tag ke Produk
            </h3>
            <p className="mt-0.5 text-xs text-[#57534E]">
              Pilih atau ketik tag lalu centang produk mana saja yang berhak
              mendapat potongan tag tersebut.
            </p>
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              value={assignTag}
              onChange={(e) => setAssignTag(e.target.value)}
              placeholder="new-member"
              aria-label="Tag to assign to products"
              className="min-h-[40px] flex-1 border border-[#E5E3DC] bg-white px-3 font-mono text-xs text-[#181817]"
            />
            <span className="inline-flex items-center border border-[#E5E3DC] bg-[#FAFAFA] px-3 font-mono text-xs text-[#57534E]">
              #{normalizeProductTag(assignTag) || "-"}
            </span>
          </div>

          <div className="max-h-[300px] divide-y divide-[#E5E3DC] overflow-y-auto border border-[#E5E3DC]">
            {products.map((prod) => {
              const cleanTag = normalizeProductTag(assignTag);
              const hasTag = Boolean(
                cleanTag && (prod.tags ?? []).includes(cleanTag)
              );
              return (
                <label
                  key={prod.id}
                  className="flex cursor-pointer items-center justify-between gap-3 px-3.5 py-2.5 text-xs hover:bg-[#FAFAFA]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <input
                      type="checkbox"
                      disabled={!cleanTag || togglingProductId === prod.id}
                      checked={hasTag}
                      onChange={() => void handleToggleProductTag(prod, assignTag)}
                      className="h-4 w-4 shrink-0 accent-[#181817]"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-[#181817]">
                        {prod.title}
                      </p>
                      {(prod.tags ?? []).length > 0 && (
                        <p className="truncate text-[10px] text-[#57534E]">
                          {(prod.tags ?? []).map((t) => `#${t}`).join(" ")}
                        </p>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 tabular-nums text-[11px] text-[#57534E]">
                    {formatIDR(prod.price)}
                  </span>
                </label>
              );
            })}
          </div>
        </div>
      </section>

      {/* SECTION 2: VOUCHER CODES CREATE / EDIT & LIST */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Create / Edit Voucher Form */}
        <form
          onSubmit={(e) => void handleVoucherSubmit(e)}
          className="space-y-4 border border-[#E5E3DC] bg-white p-6 lg:col-span-5"
        >
          <div className="flex items-center justify-between border-b border-[#E5E3DC] pb-3">
            <h2 className="font-display text-2xl font-normal text-[#181817]">
              {form.id ? `Edit Voucher ${form.code}` : "Create Voucher Code"}
            </h2>
            {form.id && (
              <button
                type="button"
                onClick={() => setForm(EMPTY_VOUCHER_FORM)}
                className="text-xs text-[#881337] underline"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <div>
            <label
              htmlFor="vch-code"
              className="block text-xs font-medium text-[#181817]"
            >
              Kode Voucher *
            </label>
            <input
              id="vch-code"
              type="text"
              required
              value={form.code}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  code: e.target.value.toUpperCase(),
                }))
              }
              placeholder="Contoh: HEMAT20 atau WELCOME50K"
              className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 font-mono text-xs uppercase tracking-wider text-[#181817]"
            />
          </div>

          <div>
            <label
              htmlFor="vch-desc"
              className="block text-xs font-medium text-[#181817]"
            >
              Deskripsi / Catatan
            </label>
            <input
              id="vch-desc"
              type="text"
              value={form.description}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, description: e.target.value }))
              }
              placeholder="Diskon 20% koleksi SS27"
              className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="vch-type"
                className="block text-xs font-medium text-[#181817]"
              >
                Tipe Potongan
              </label>
              <select
                id="vch-type"
                value={form.discountType}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    discountType:
                      e.target.value === "fixed" ? "fixed" : "percent",
                  }))
                }
                className="mt-1 h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
              >
                <option value="percent">Persentase (%)</option>
                <option value="fixed">Nominal Tetap (Rp)</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="vch-val"
                className="block text-xs font-medium text-[#181817]"
              >
                {form.discountType === "percent"
                  ? "Potongan (%)"
                  : "Potongan (Rp)"}
              </label>
              <input
                id="vch-val"
                type="number"
                required
                min={form.discountType === "percent" ? 1 : 1000}
                max={form.discountType === "percent" ? 95 : undefined}
                value={form.discountValue}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    discountValue: e.target.value,
                  }))
                }
                className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {form.discountType === "percent" && (
              <div>
                <label
                  htmlFor="vch-max"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Maks. Potongan (Rp)
                </label>
                <input
                  id="vch-max"
                  type="number"
                  min="0"
                  placeholder="Kosong = tanpa batas"
                  value={form.maxDiscount}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      maxDiscount: e.target.value,
                    }))
                  }
                  className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
                />
              </div>
            )}

            <div>
              <label
                htmlFor="vch-min"
                className="block text-xs font-medium text-[#181817]"
              >
                Min. Belanja (Rp)
              </label>
              <input
                id="vch-min"
                type="number"
                min="0"
                value={form.minSubtotal}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, minSubtotal: e.target.value }))
                }
                className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="vch-limit"
                className="block text-xs font-medium text-[#181817]"
              >
                Batas Kuota Pakai
              </label>
              <input
                id="vch-limit"
                type="number"
                min="1"
                placeholder="Kosong = unlimited"
                value={form.usageLimit}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, usageLimit: e.target.value }))
                }
                className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
              />
            </div>

            <div>
              <label
                htmlFor="vch-exp"
                className="block text-xs font-medium text-[#181817]"
              >
                Kadaluarsa (Opsional)
              </label>
              <input
                id="vch-exp"
                type="datetime-local"
                value={form.expiresAt}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, expiresAt: e.target.value }))
                }
                className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
              />
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-[#181817]">
              Target Produk Voucher
            </span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, scope: "global" }))}
                className={`min-h-[40px] border text-xs font-medium ${
                  form.scope === "global"
                    ? "border-[#181817] bg-[#181817] text-white"
                    : "border-[#E5E3DC] bg-white text-[#181817]"
                }`}
              >
                Global
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, scope: "tags" }))}
                className={`min-h-[40px] border text-xs font-medium ${
                  form.scope === "tags"
                    ? "border-[#181817] bg-[#181817] text-white"
                    : "border-[#E5E3DC] bg-white text-[#181817]"
                }`}
              >
                Tag Produk
              </button>
            </div>
          </div>

          {form.scope === "tags" && (
            <div className="space-y-2 border border-[#E5E3DC] bg-[#FAFAFA] p-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={voucherTagInput}
                  onChange={(e) => setVoucherTagInput(e.target.value)}
                  placeholder="Tambah tag..."
                  className="min-h-[38px] flex-1 border border-[#E5E3DC] bg-white px-2.5 text-xs text-[#181817]"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = normalizeProductTag(voucherTagInput);
                    if (!clean) return;
                    setForm((prev) => ({
                      ...prev,
                      tags: Array.from(new Set([...prev.tags, clean])),
                    }));
                    setVoucherTagInput("");
                  }}
                  className="min-h-[38px] border border-[#181817] bg-white px-3 text-xs font-medium"
                >
                  + Tag
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {allExistingTags.map((t) => {
                  const active = form.tags.includes(t);
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          tags: prev.tags.includes(t)
                            ? prev.tags.filter((x) => x !== t)
                            : [...prev.tags, t],
                        }))
                      }
                      className={`border px-2 py-0.5 text-[10px] font-medium ${
                        active
                          ? "border-[#181817] bg-[#181817] text-white"
                          : "border-[#E5E3DC] bg-white text-[#57534E]"
                      }`}
                    >
                      #{t}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <label className="flex items-center gap-2 text-xs text-[#181817]">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, isActive: e.target.checked }))
              }
              className="h-4 w-4 accent-[#181817]"
            />
            Voucher langsung aktif
          </label>

          <button
            type="submit"
            disabled={savingVoucher}
            className="min-h-[46px] w-full bg-[#181817] px-5 text-xs font-medium tracking-wide text-white hover:bg-[#333330] disabled:opacity-60"
          >
            {savingVoucher
              ? "Saving Voucher..."
              : form.id
              ? "Update Voucher"
              : "+ Create Voucher"}
          </button>
        </form>

        {/* Live Voucher List */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl font-normal text-[#181817]">
              Voucher Codes ({vouchers.length})
            </h2>
          </div>

          {vouchers.length === 0 ? (
            <div className="border border-[#E5E3DC] bg-white p-10 text-center text-xs text-[#57534E]">
              Belum ada kode voucher. Buat kode voucher pertama Anda di form
              sebelah kiri.
            </div>
          ) : (
            <div className="divide-y divide-[#E5E3DC] border border-[#E5E3DC] bg-white">
              {vouchers.map((v) => {
                const confirming = confirmDeleteVoucherId === v.id;
                const discountSummary =
                  v.discountType === "percent"
                    ? `${v.discountValue}%${
                        v.maxDiscount
                          ? ` (Max ${formatIDR(v.maxDiscount)})`
                          : ""
                      }`
                    : formatIDR(v.discountValue);

                return (
                  <div
                    key={v.id}
                    className="flex flex-col justify-between gap-3 p-4 sm:flex-row sm:items-start"
                  >
                    <div className="min-w-0 space-y-1.5 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-semibold tracking-wider text-[#181817]">
                          {v.code}
                        </span>
                        <span className="bg-[#181817] px-2 py-0.5 text-[10px] font-semibold tabular-nums text-white">
                          -{discountSummary}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                            v.isActive
                              ? "bg-emerald-950 text-emerald-100"
                              : "bg-[#E5E3DC] text-[#57534E]"
                          }`}
                        >
                          {v.isActive ? "Active" : "Inactive"}
                        </span>
                      </div>

                      {v.description && (
                        <p className="text-[#57534E]">{v.description}</p>
                      )}

                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#57534E]">
                        <span>
                          Scope:{" "}
                          <strong className="text-[#181817]">
                            {v.scope === "global"
                              ? "Global"
                              : v.tags.map((t) => `#${t}`).join(", ")}
                          </strong>
                        </span>
                        {v.minSubtotal > 0 && (
                          <span className="tabular-nums">
                            Min. {formatIDR(v.minSubtotal)}
                          </span>
                        )}
                        <span className="tabular-nums">
                          Dipakai: {v.usedCount}
                          {v.usageLimit !== null ? ` / ${v.usageLimit}` : " / ∞"}
                        </span>
                        {v.expiresAt && (
                          <span className="tabular-nums">
                            Exp:{" "}
                            {new Date(v.expiresAt).toLocaleString("id-ID", {
                              dateStyle: "short",
                              timeStyle: "short",
                            })}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleToggleVoucherActive(v)}
                        className="min-h-[36px] border border-[#E5E3DC] bg-white px-2.5 text-[11px] font-medium text-[#181817] hover:border-[#181817]"
                      >
                        {v.isActive ? "Nonaktifkan" : "Aktifkan"}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditVoucher(v)}
                        className="min-h-[36px] border border-[#E5E3DC] bg-white px-2.5 text-[11px] font-medium text-[#181817] hover:border-[#181817]"
                      >
                        Edit
                      </button>
                      {confirming ? (
                        <>
                          <button
                            type="button"
                            onClick={() => void handleDeleteVoucher(v)}
                            className="min-h-[36px] bg-[#881337] px-2.5 text-[11px] font-medium text-white"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteVoucherId(null)}
                            className="min-h-[36px] border border-[#E5E3DC] px-2 text-[11px]"
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteVoucherId(v.id)}
                          className="min-h-[36px] border border-[#E5E3DC] bg-white px-2.5 text-[11px] font-medium text-[#881337] hover:border-[#881337]"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
