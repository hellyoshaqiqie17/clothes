"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CUT_LABELS, formatIDR } from "@/data/catalogProducts";
import ProductDetailModal from "@/components/marketplace/ProductDetailModal";
import SellerStudioModal from "@/components/marketplace/SellerStudioModal";
import type {
  BinderPayConfigStatus,
  CatalogProduct,
  HeroSlide,
  NewsletterSubscriber,
  OrderStatus,
  ProductPreviews,
  StoreOrder,
  StoreSettings,
} from "@/types/catalog";

interface AdminConsoleProps {
  initialProducts: CatalogProduct[];
  initialHeroSlides: HeroSlide[];
  initialSettings: StoreSettings;
  initialOrders: StoreOrder[];
  initialSubscribers: NewsletterSubscriber[];
}

type AdminTab = "products" | "hero" | "orders" | "settings";

export default function AdminConsole({
  initialProducts,
  initialHeroSlides,
  initialSettings,
  initialOrders,
  initialSubscribers,
}: AdminConsoleProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("products");
  const [products, setProducts] = useState<CatalogProduct[]>(initialProducts);
  const [heroSlides, setHeroSlides] = useState<HeroSlide[]>(initialHeroSlides);
  const [settings, setSettings] = useState<StoreSettings>(initialSettings);
  const [orders, setOrders] = useState<StoreOrder[]>(initialOrders);
  const [subscribers, setSubscribers] = useState<NewsletterSubscriber[]>(
    initialSubscribers
  );
  const [previewsById, setPreviewsById] = useState<Record<string, ProductPreviews>>({});

  // Product list filters
  const [query, setQuery] = useState("");
  const [catFilter, setCatFilter] = useState<"all" | "top" | "bottom">("all");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeleteOrderId, setConfirmDeleteOrderId] = useState<string | null>(null);

  // Modals
  const [editorState, setEditorState] = useState<{
    open: boolean;
    editingProduct: CatalogProduct | null;
  }>({ open: false, editingProduct: null });
  const [inspectModal, setInspectModal] = useState<{
    productId: string;
    mode: "2d" | "3d";
  } | null>(null);

  // Save states & feedback
  const [savingSlides, setSavingSlides] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [syncingOrderId, setSyncingOrderId] = useState<string | null>(null);
  const [gatewayConfig, setGatewayConfig] =
    useState<BinderPayConfigStatus | null>(null);
  const [copiedUrlKey, setCopiedUrlKey] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/payments/binderpay/config", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as BinderPayConfigStatus;
        if (active) setGatewayConfig(data);
      })
      .catch(() => {
        // non-blocking
      });
    return () => {
      active = false;
    };
  }, []);

  const flashStatus = (msg: string) => {
    setErrorMsg(null);
    setStatusMsg(msg);
    window.setTimeout(() => {
      setStatusMsg((cur) => (cur === msg ? null : cur));
    }, 3500);
  };

  const filteredProducts = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (catFilter !== "all" && p.category !== catFilter) return false;
      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.colorTag.toLowerCase().includes(q) ||
        p.cut.toLowerCase().includes(q)
      );
    });
  }, [products, query, catFilter]);

  const totalRevenue = useMemo(
    () =>
      orders
        .filter((o) => o.status !== "cancelled")
        .reduce((sum, o) => sum + (o.total || o.subtotal), 0),
    [orders]
  );

  const handleToggleFeatured = async (product: CatalogProduct) => {
    const nextVal = !product.isFeatured;
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(product.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isFeatured: nextVal }),
      });
      if (!res.ok) throw new Error("Failed to update featured status.");
      const data = (await res.json()) as { product: CatalogProduct };
      setProducts((prev) =>
        prev.map((p) => (p.id === product.id ? data.product : p))
      );
      flashStatus(
        nextVal
          ? `Pinned "${product.title}" to New & Featured.`
          : `Unpinned "${product.title}" from New & Featured.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Update failed.");
    }
  };

  const handleDeleteProduct = async (product: CatalogProduct) => {
    try {
      const res = await fetch(`/api/products/${encodeURIComponent(product.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete product.");
      setProducts((prev) => prev.filter((p) => p.id !== product.id));
      setHeroSlides((prev) => prev.filter((s) => s.productId !== product.id));
      setConfirmDeleteId(null);
      flashStatus(`Deleted "${product.title}" from database.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Delete failed.");
    }
  };

  const handleProductSaved = (
    saved: CatalogProduct,
    builtPreviews: ProductPreviews | null
  ) => {
    setProducts((prev) => {
      const exists = prev.some((p) => p.id === saved.id);
      if (exists) return prev.map((p) => (p.id === saved.id ? saved : p));
      return [saved, ...prev];
    });
    if (builtPreviews) {
      setPreviewsById((prev) => ({ ...prev, [saved.id]: builtPreviews }));
    }
    setEditorState({ open: false, editingProduct: null });
    flashStatus(`Saved "${saved.title}" to SQLite database.`);
  };

  const handleSaveHeroSlides = async (e: React.FormEvent) => {
    e.preventDefault();
    if (heroSlides.length === 0) {
      setErrorMsg("Add at least one hero slide before saving.");
      return;
    }
    setSavingSlides(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/hero-slides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heroSlides }),
      });
      const data = (await res.json()) as { heroSlides?: HeroSlide[]; error?: string };
      if (!res.ok || !data.heroSlides) {
        throw new Error(data.error || "Failed to save hero slides.");
      }
      setHeroSlides(data.heroSlides);
      flashStatus("Hero carousel slides saved to database.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to save slides.");
    } finally {
      setSavingSlides(false);
    }
  };

  const handleAddHeroSlide = () => {
    const defaultProd = products[0];
    if (!defaultProd) return;
    setHeroSlides((prev) => [
      ...prev,
      {
        id: `slide-${Date.now()}`,
        productId: defaultProd.id,
        headlineStart: `${defaultProd.title}, `,
        headlineItalic: "cut",
        headlineEnd: " for daily rotation.",
        subtitle: defaultProd.description,
        ctaLabel: `Shop ${defaultProd.title}`,
        sortOrder: prev.length + 1,
      },
    ]);
  };

  const handleOrderStatusChange = async (orderId: string, status: OrderStatus) => {
    try {
      const res = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: orderId, status }),
      });
      const data = (await res.json()) as { order?: StoreOrder; error?: string };
      if (!res.ok || !data.order) {
        throw new Error(data.error || "Failed to update order status.");
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? data.order! : o))
      );
      flashStatus(`Order ${orderId} marked as ${status}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Order update failed.");
    }
  };

  const handleSyncOrderPayment = async (orderId: string) => {
    setSyncingOrderId(orderId);
    setErrorMsg(null);
    try {
      const res = await fetch(
        `/api/payments/binderpay/status?orderId=${encodeURIComponent(orderId)}`,
        { cache: "no-store" }
      );
      const data = (await res.json()) as {
        order?: StoreOrder;
        gatewayError?: string;
        error?: string;
      };
      if (!res.ok || !data.order) {
        throw new Error(data.error || "Failed to sync BinderPay status.");
      }
      setOrders((prev) =>
        prev.map((o) => (o.id === orderId ? data.order! : o))
      );
      if (data.gatewayError) {
        setErrorMsg(`BinderPay inquiry notice: ${data.gatewayError}`);
      } else {
        const payStatus = data.order.payment?.status || data.order.status;
        flashStatus(`Synced ${orderId} from BinderPay (${payStatus}).`);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to sync BinderPay status."
      );
    } finally {
      setSyncingOrderId(null);
    }
  };

  const handleCopyWebhookUrl = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrlKey(key);
      window.setTimeout(() => {
        setCopiedUrlKey((cur) => (cur === key ? null : cur));
      }, 2000);
    } catch {
      setErrorMsg("Clipboard unavailable. Copy the URL manually.");
    }
  };

  const handleDeleteOrder = async (orderId: string) => {
    try {
      const res = await fetch(
        `/api/orders?id=${encodeURIComponent(orderId)}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to delete order.");
      setOrders((prev) => prev.filter((o) => o.id !== orderId));
      setConfirmDeleteOrderId(null);
      flashStatus(`Deleted order ${orderId} from database.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Order delete failed.");
    }
  };

  const handleDeleteSubscriber = async (sub: NewsletterSubscriber) => {
    try {
      const res = await fetch(`/api/newsletter?id=${sub.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to remove subscriber.");
      setSubscribers((prev) => prev.filter((s) => s.id !== sub.id));
      flashStatus(`Removed ${sub.email} from newsletter list.`);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to remove subscriber."
      );
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = (await res.json()) as { settings?: StoreSettings; error?: string };
      if (!res.ok || !data.settings) {
        throw new Error(data.error || "Failed to save settings.");
      }
      setSettings(data.settings);
      flashStatus("Store settings saved to database.");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Settings update failed.");
    } finally {
      setSavingSettings(false);
    }
  };

  const inspectingProduct = inspectModal
    ? products.find((p) => p.id === inspectModal.productId) ?? null
    : null;

  return (
    <div className="min-h-[100dvh] bg-white text-[#181817]">
      {/* Admin Header */}
      <header className="sticky top-0 z-30 border-b border-[#E5E3DC] bg-white/95 backdrop-blur-sm">
        <div className="mx-auto flex h-[68px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="font-display text-2xl font-medium tracking-tight text-[#181817]"
            >
              {settings.storeName}
            </Link>
            <span className="border border-[#E5E3DC] bg-[#FAFAFA] px-2.5 py-0.5 text-[11px] font-medium text-[#57534E]">
              Admin
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex min-h-[44px] items-center border border-[#E5E3DC] bg-white px-3 text-xs font-medium text-[#181817] transition-colors hover:border-[#181817] sm:px-4"
            >
              <span className="hidden sm:inline">View Storefront</span>
              <span className="sm:hidden">Store</span>
            </Link>
            <button
              type="button"
              onClick={() => setEditorState({ open: true, editingProduct: null })}
              className="min-h-[44px] bg-[#181817] px-3 text-xs font-medium tracking-wide text-white transition-colors hover:bg-[#333330] sm:px-4"
            >
              <span className="hidden sm:inline">+ Create Product</span>
              <span className="sm:hidden">+ New</span>
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        {/* Page Heading */}
        <div className="flex flex-col justify-between gap-4 border-b border-[#E5E3DC] pb-6 sm:flex-row sm:items-end">
          <div>
            <h1 className="font-display text-3xl font-normal tracking-[-0.015em] text-[#181817] sm:text-4xl">
              Store Admin Panel
            </h1>
            <p className="mt-1.5 text-sm text-[#57534E]">
              Create and manage products with 2D photos and 3D garment views, hero banners, BinderPay orders, and store copy directly in Cloudflare D1.
            </p>
          </div>
        </div>

        {/* Live Database Metrics */}
        <section
          aria-label="Store metrics"
          className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4"
        >
          <div className="border border-[#E5E3DC] bg-white p-4">
            <p className="text-xs font-medium text-[#57534E]">Catalog Products</p>
            <p className="mt-1.5 font-display text-3xl font-normal tabular-nums text-[#181817]">
              {products.length}
            </p>
          </div>
          <div className="border border-[#E5E3DC] bg-white p-4">
            <p className="text-xs font-medium text-[#57534E]">Hero Banner Slides</p>
            <p className="mt-1.5 font-display text-3xl font-normal tabular-nums text-[#181817]">
              {heroSlides.length}
            </p>
          </div>
          <div className="border border-[#E5E3DC] bg-white p-4">
            <p className="text-xs font-medium text-[#57534E]">Recorded Orders</p>
            <p className="mt-1.5 font-display text-3xl font-normal tabular-nums text-[#181817]">
              {orders.length}
            </p>
            {orders.length > 0 && (
              <p className="mt-0.5 text-xs tabular-nums text-[#57534E]">
                {formatIDR(totalRevenue)} total
              </p>
            )}
          </div>
          <div className="border border-[#E5E3DC] bg-white p-4">
            <p className="text-xs font-medium text-[#57534E]">Newsletter List</p>
            <p className="mt-1.5 font-display text-3xl font-normal tabular-nums text-[#181817]">
              {subscribers.length}
            </p>
          </div>
        </section>

        {/* Feedback Banners */}
        {statusMsg && (
          <div
            role="status"
            className="mt-6 flex items-center justify-between border border-[#181817] bg-[#FAFAFA] px-4 py-3 text-xs font-medium text-[#181817]"
          >
            <span>{statusMsg}</span>
            <button
              type="button"
              onClick={() => setStatusMsg(null)}
              aria-label="Dismiss status message"
              className="px-2 text-sm text-[#57534E] hover:text-[#181817]"
            >
              ×
            </button>
          </div>
        )}

        {errorMsg && (
          <div
            role="alert"
            className="mt-6 flex items-center justify-between border border-[#881337] bg-[#FFF1F2] px-4 py-3 text-xs font-medium text-[#881337]"
          >
            <span>{errorMsg}</span>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              aria-label="Dismiss error message"
              className="px-2 text-sm hover:underline"
            >
              ×
            </button>
          </div>
        )}

        {/* Admin Section Tabs */}
        <div
          role="tablist"
          aria-label="Admin sections"
          className="mt-8 flex flex-wrap gap-2 border-b border-[#E5E3DC] pb-4"
        >
          {(
            [
              { id: "products", label: `Products (${products.length})` },
              { id: "hero", label: `Hero Slides (${heroSlides.length})` },
              { id: "orders", label: `Orders & Subscribers (${orders.length})` },
              { id: "settings", label: "Store Settings" },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-[44px] border px-4 text-xs font-medium transition-colors ${
                  active
                    ? "border-[#181817] bg-[#181817] text-white"
                    : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: PRODUCTS MANAGEMENT */}
        {activeTab === "products" && (
          <section className="mt-6">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { id: "all", label: "All" },
                    { id: "top", label: "Tops" },
                    { id: "bottom", label: "Bottoms" },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setCatFilter(f.id)}
                    aria-pressed={catFilter === f.id}
                    className={`min-h-[40px] border px-3.5 text-xs font-medium ${
                      catFilter === f.id
                        ? "border-[#181817] bg-[#181817] text-white"
                        : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="admin-product-search" className="sr-only">
                  Search products
                </label>
                <input
                  id="admin-product-search"
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search by name, brand, color..."
                  className="min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3.5 text-xs text-[#181817] sm:w-72"
                />
              </div>
            </div>

            {filteredProducts.length === 0 ? (
              <div className="mt-6 border border-[#E5E3DC] p-12 text-center">
                <p className="text-sm font-semibold text-[#181817]">
                  No products found
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setEditorState({ open: true, editingProduct: null })
                  }
                  className="mt-4 min-h-[44px] bg-[#181817] px-5 text-xs font-medium text-white"
                >
                  + Create Product
                </button>
              </div>
            ) : (
              <div className="mt-6 divide-y divide-[#E5E3DC] border border-[#E5E3DC]">
                {filteredProducts.map((product) => {
                  const thumb =
                    product.mapping.frontImageUrl ||
                    previewsById[product.id]?.front2d ||
                    "";
                  const isConfirming = confirmDeleteId === product.id;

                  return (
                    <div
                      key={product.id}
                      className="flex flex-col gap-4 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-center gap-4">
                        <div className="h-20 w-20 shrink-0 overflow-hidden border border-[#E5E3DC] bg-[#EFEFEB]">
                          {thumb ? (
                            <Image
                              src={thumb}
                              alt={product.title}
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

                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#57534E]">
                              {product.brand}
                            </span>
                            {product.badge && (
                              <span className="bg-[#181817] px-2 py-0.5 text-[10px] font-medium text-white">
                                {product.badge}
                              </span>
                            )}
                            {product.isFeatured && (
                              <span className="bg-[#881337] px-2 py-0.5 text-[10px] font-medium text-white">
                                Featured
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-sm font-semibold text-[#181817]">
                            {product.title}
                          </p>
                          <p className="mt-0.5 text-xs text-[#57534E]">
                            {CUT_LABELS[product.cut]} · {product.stockStatus} ·{" "}
                            <span className="font-semibold tabular-nums text-[#181817]">
                              {formatIDR(product.price)}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void handleToggleFeatured(product)}
                          aria-pressed={Boolean(product.isFeatured)}
                          className={`min-h-[40px] border px-3 text-xs font-medium transition-colors ${
                            product.isFeatured
                              ? "border-[#881337] bg-[#881337] text-white"
                              : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                          }`}
                        >
                          {product.isFeatured ? "Featured" : "Pin Featured"}
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setInspectModal({ productId: product.id, mode: "3d" })
                          }
                          className="min-h-[40px] border border-[#181817] bg-white px-3 text-xs font-medium text-[#181817] hover:bg-[#F5F5F5]"
                        >
                          Inspect 2D/3D
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            setEditorState({ open: true, editingProduct: product })
                          }
                          className="min-h-[40px] border border-[#E5E3DC] bg-white px-3 text-xs font-medium text-[#181817] hover:border-[#181817]"
                        >
                          Edit
                        </button>

                        {isConfirming ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleDeleteProduct(product)}
                              className="min-h-[40px] bg-[#881337] px-3 text-xs font-medium text-white hover:bg-[#9F1239]"
                            >
                              Confirm Delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="min-h-[40px] border border-[#E5E3DC] px-2.5 text-xs text-[#57534E]"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(product.id)}
                            className="min-h-[40px] border border-[#E5E3DC] bg-white px-3 text-xs font-medium text-[#881337] hover:border-[#881337]"
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
          </section>
        )}

        {/* TAB 2: HERO SLIDES MANAGEMENT */}
        {activeTab === "hero" && (
          <form onSubmit={(e) => void handleSaveHeroSlides(e)} className="mt-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[#57534E]">
                Choose which garments appear in the homepage 3D hero carousel and customize their editorial headlines.
              </p>
              <button
                type="button"
                onClick={handleAddHeroSlide}
                className="min-h-[44px] border border-[#181817] bg-white px-4 text-xs font-medium text-[#181817] hover:bg-[#F5F5F5]"
              >
                + Add Slide
              </button>
            </div>

            <div className="space-y-4">
              {heroSlides.map((slide, idx) => (
                <div
                  key={slide.id}
                  className="space-y-4 border border-[#E5E3DC] bg-white p-5"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-[#E5E3DC] pb-3">
                    <span className="text-xs font-semibold text-[#181817]">
                      Slide 0{idx + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      {idx > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setHeroSlides((prev) => {
                              const copy = [...prev];
                              [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                              return copy;
                            });
                          }}
                          className="min-h-[36px] border border-[#E5E3DC] px-2.5 text-xs hover:border-[#181817]"
                        >
                          Move Up
                        </button>
                      )}
                      {heroSlides.length > 1 && (
                        <button
                          type="button"
                          onClick={() =>
                            setHeroSlides((prev) =>
                              prev.filter((s) => s.id !== slide.id)
                            )
                          }
                          className="min-h-[36px] border border-[#E5E3DC] px-2.5 text-xs text-[#881337] hover:border-[#881337]"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <div>
                      <label
                        htmlFor={`slide-prod-${slide.id}`}
                        className="block text-xs font-medium text-[#181817]"
                      >
                        Linked 3D Product
                      </label>
                      <select
                        id={`slide-prod-${slide.id}`}
                        value={slide.productId}
                        onChange={(e) =>
                          setHeroSlides((prev) =>
                            prev.map((s) =>
                              s.id === slide.id
                                ? { ...s, productId: e.target.value }
                                : s
                            )
                          )
                        }
                        className="mt-1 h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title} ({formatIDR(p.price)})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor={`slide-cta-${slide.id}`}
                        className="block text-xs font-medium text-[#181817]"
                      >
                        Primary Button Label
                      </label>
                      <input
                        id={`slide-cta-${slide.id}`}
                        type="text"
                        value={slide.ctaLabel}
                        onChange={(e) =>
                          setHeroSlides((prev) =>
                            prev.map((s) =>
                              s.id === slide.id
                                ? { ...s, ctaLabel: e.target.value }
                                : s
                            )
                          )
                        }
                        className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    <div>
                      <label
                        htmlFor={`slide-h1-${slide.id}`}
                        className="block text-xs font-medium text-[#181817]"
                      >
                        Headline Start
                      </label>
                      <input
                        id={`slide-h1-${slide.id}`}
                        type="text"
                        value={slide.headlineStart}
                        onChange={(e) =>
                          setHeroSlides((prev) =>
                            prev.map((s) =>
                              s.id === slide.id
                                ? { ...s, headlineStart: e.target.value }
                                : s
                            )
                          )
                        }
                        className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`slide-h2-${slide.id}`}
                        className="block text-xs font-medium text-[#181817]"
                      >
                        Italic Accent Word
                      </label>
                      <input
                        id={`slide-h2-${slide.id}`}
                        type="text"
                        value={slide.headlineItalic}
                        onChange={(e) =>
                          setHeroSlides((prev) =>
                            prev.map((s) =>
                              s.id === slide.id
                                ? { ...s, headlineItalic: e.target.value }
                                : s
                            )
                          )
                        }
                        className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs italic text-[#181817]"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor={`slide-h3-${slide.id}`}
                        className="block text-xs font-medium text-[#181817]"
                      >
                        Headline End
                      </label>
                      <input
                        id={`slide-h3-${slide.id}`}
                        type="text"
                        value={slide.headlineEnd}
                        onChange={(e) =>
                          setHeroSlides((prev) =>
                            prev.map((s) =>
                              s.id === slide.id
                                ? { ...s, headlineEnd: e.target.value }
                                : s
                            )
                          )
                        }
                        className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor={`slide-sub-${slide.id}`}
                      className="block text-xs font-medium text-[#181817]"
                    >
                      Subtitle Description
                    </label>
                    <textarea
                      id={`slide-sub-${slide.id}`}
                      rows={2}
                      value={slide.subtitle}
                      onChange={(e) =>
                        setHeroSlides((prev) =>
                          prev.map((s) =>
                            s.id === slide.id ? { ...s, subtitle: e.target.value } : s
                          )
                        )
                      }
                      className="mt-1 w-full border border-[#E5E3DC] bg-white p-2.5 text-xs text-[#181817]"
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={savingSlides}
                className="min-h-[48px] bg-[#181817] px-6 text-xs font-medium tracking-wide text-white hover:bg-[#333330] disabled:opacity-60"
              >
                {savingSlides ? "Saving Slides..." : "Save Hero Slides"}
              </button>
            </div>
          </form>
        )}

        {/* TAB 3: ORDERS & SUBSCRIBERS */}
        {activeTab === "orders" && (
          <section className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="lg:col-span-8">
              <h2 className="font-display text-2xl font-normal text-[#181817]">
                Orders ({orders.length})
              </h2>
              {orders.length === 0 ? (
                <div className="mt-4 border border-[#E5E3DC] p-8 text-center text-xs text-[#57534E]">
                  No orders recorded yet. Place an order from the storefront bag to see it appear here.
                </div>
              ) : (
                <div className="mt-4 divide-y divide-[#E5E3DC] border border-[#E5E3DC]">
                  {orders.map((order) => {
                    const confirming = confirmDeleteOrderId === order.id;
                    return (
                      <div
                        key={order.id}
                        className="flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-start"
                      >
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-xs font-semibold text-[#181817]">
                              {order.id} · {order.itemCount} item(s) ·{" "}
                              <span className="tabular-nums">
                                {formatIDR(order.total || order.subtotal)}
                              </span>
                            </p>
                            <span className="text-[11px] tabular-nums text-[#57534E]">
                              {new Date(order.createdAt).toLocaleString("id-ID", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </span>
                          </div>

                          {order.customerName && (
                            <div className="border-l-2 border-[#E5E3DC] pl-3 text-xs text-[#57534E]">
                              <p className="font-medium text-[#181817]">
                                {order.customerName} · {order.customerPhone} ·{" "}
                                {order.customerEmail}
                              </p>
                              <p className="mt-0.5">
                                {order.shippingAddress}, {order.shippingCity}
                              </p>
                              {order.notes && (
                                <p className="mt-0.5 italic">
                                  Note: {order.notes}
                                </p>
                              )}
                            </div>
                          )}

                          <ul className="space-y-0.5 text-xs text-[#57534E]">
                            {order.items.map((item) => (
                              <li key={item.key}>
                                {item.quantity}x {item.title} (Size {item.size}) ·{" "}
                                <span className="tabular-nums">
                                  {formatIDR(item.price * item.quantity)}
                                </span>
                              </li>
                            ))}
                          </ul>

                          <p className="text-[11px] text-[#57534E]">
                            Subtotal {formatIDR(order.subtotal)} · Shipping{" "}
                            {order.shippingFee === 0
                              ? "Free"
                              : formatIDR(order.shippingFee)}{" "}
                            · {order.paymentMethod}
                          </p>

                          {order.payment && (
                            <div className="flex flex-wrap items-center gap-2 border border-[#E5E3DC] bg-[#FAFAFA] px-3 py-2 text-[11px]">
                              <span
                                className={`px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                                  order.payment.status === "paid"
                                    ? "bg-emerald-950 text-emerald-100"
                                    : order.payment.status === "pending"
                                    ? "border border-[#881337] bg-[#FFF1F2] text-[#881337]"
                                    : "bg-[#E5E3DC] text-[#57534E]"
                                }`}
                              >
                                {order.payment.status}
                              </span>
                              <span className="font-mono text-[#181817]">
                                {order.payment.channel} · {order.payment.trxId}
                              </span>
                              {order.payment.virtualAccountNo && (
                                <span className="font-mono text-[#57534E]">
                                  VA {order.payment.virtualAccountNo}
                                </span>
                              )}
                              {order.payment.referenceNo && (
                                <span className="font-mono text-[#57534E]">
                                  Ref {order.payment.referenceNo}
                                </span>
                              )}
                              {order.payment.paidAt && (
                                <span className="tabular-nums text-[#57534E]">
                                  Paid{" "}
                                  {new Date(order.payment.paidAt).toLocaleString(
                                    "id-ID",
                                    { dateStyle: "short", timeStyle: "short" }
                                  )}
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
                          {order.payment && order.payment.status === "pending" && (
                            <button
                              type="button"
                              disabled={syncingOrderId === order.id}
                              onClick={() => void handleSyncOrderPayment(order.id)}
                              className="min-h-[38px] border border-[#181817] bg-white px-3 text-[11px] font-medium text-[#181817] hover:bg-[#181817] hover:text-white disabled:opacity-50"
                            >
                              {syncingOrderId === order.id
                                ? "Syncing..."
                                : "Sync BinderPay"}
                            </button>
                          )}
                          <div className="flex items-center gap-2">
                            <label
                              htmlFor={`order-status-${order.id}`}
                              className="text-xs text-[#57534E]"
                            >
                              Status
                            </label>
                            <select
                              id={`order-status-${order.id}`}
                              value={order.status}
                              onChange={(e) =>
                                void handleOrderStatusChange(
                                  order.id,
                                  e.target.value as OrderStatus
                                )
                              }
                              className="h-[44px] border border-[#E5E3DC] bg-white px-2.5 text-xs capitalize text-[#181817]"
                            >
                              <option value="pending">Pending</option>
                              <option value="confirmed">Confirmed</option>
                              <option value="shipped">Shipped</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </div>

                          {confirming ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => void handleDeleteOrder(order.id)}
                                className="min-h-[40px] bg-[#881337] px-3 text-xs font-medium text-white hover:bg-[#9F1239]"
                              >
                                Confirm Delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteOrderId(null)}
                                className="min-h-[40px] border border-[#E5E3DC] px-2.5 text-xs text-[#57534E]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteOrderId(order.id)}
                              className="min-h-[40px] border border-[#E5E3DC] px-3 text-xs font-medium text-[#881337] hover:border-[#881337]"
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

            <div className="lg:col-span-4">
              <h2 className="font-display text-2xl font-normal text-[#181817]">
                Newsletter ({subscribers.length})
              </h2>
              {subscribers.length === 0 ? (
                <div className="mt-4 border border-[#E5E3DC] p-6 text-center text-xs text-[#57534E]">
                  No newsletter subscribers yet.
                </div>
              ) : (
                <ul className="mt-4 divide-y divide-[#E5E3DC] border border-[#E5E3DC]">
                  {subscribers.map((sub) => (
                    <li
                      key={sub.id}
                      className="flex items-center justify-between gap-2 px-4 py-3 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-[#181817]">
                          {sub.email}
                        </p>
                        <p className="text-[11px] tabular-nums text-[#57534E]">
                          {new Date(sub.createdAt).toLocaleDateString("id-ID")}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDeleteSubscriber(sub)}
                        aria-label={`Remove ${sub.email}`}
                        className="flex min-h-[40px] min-w-[40px] shrink-0 items-center justify-center border border-[#E5E3DC] text-xs text-[#881337] hover:border-[#881337]"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* TAB 4: STORE SETTINGS */}
        {activeTab === "settings" && (
          <form
            onSubmit={(e) => void handleSaveSettings(e)}
            className="mt-6 max-w-2xl space-y-5 border border-[#E5E3DC] bg-white p-6"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="setting-store-name"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Store Name
                </label>
                <input
                  id="setting-store-name"
                  type="text"
                  value={settings.storeName}
                  onChange={(e) =>
                    setSettings((prev) => ({ ...prev, storeName: e.target.value }))
                  }
                  className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                />
              </div>

              <div>
                <label
                  htmlFor="setting-location"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Store Location (Footer)
                </label>
                <input
                  id="setting-location"
                  type="text"
                  value={settings.storeLocation}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      storeLocation: e.target.value,
                    }))
                  }
                  className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setting-announcement"
                className="block text-xs font-medium text-[#181817]"
              >
                Top Announcement Bar Text
              </label>
              <input
                id="setting-announcement"
                type="text"
                value={settings.announcementText}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    announcementText: e.target.value,
                  }))
                }
                className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label
                  htmlFor="setting-threshold"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Free Shipping Over (IDR)
                </label>
                <input
                  id="setting-threshold"
                  type="number"
                  min="0"
                  step="50000"
                  value={settings.freeShippingThreshold}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      freeShippingThreshold: Number(e.target.value) || 0,
                    }))
                  }
                  className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
                />
              </div>

              <div>
                <label
                  htmlFor="setting-shipping-fee"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Standard Shipping Fee (IDR)
                </label>
                <input
                  id="setting-shipping-fee"
                  type="number"
                  min="0"
                  step="5000"
                  value={settings.standardShippingFee}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      standardShippingFee: Number(e.target.value) || 0,
                    }))
                  }
                  className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
                />
              </div>

              <div>
                <label
                  htmlFor="setting-exchange-days"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Size Exchange Window (Days)
                </label>
                <input
                  id="setting-exchange-days"
                  type="number"
                  min="1"
                  max="90"
                  value={settings.exchangePolicyDays}
                  onChange={(e) =>
                    setSettings((prev) => ({
                      ...prev,
                      exchangePolicyDays: Math.max(1, Number(e.target.value) || 14),
                    }))
                  }
                  className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setting-support-email"
                className="block text-xs font-medium text-[#181817]"
              >
                Customer Support Email
              </label>
              <input
                id="setting-support-email"
                type="email"
                value={settings.supportEmail}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    supportEmail: e.target.value,
                  }))
                }
                className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
              />
            </div>

            <div>
              <label
                htmlFor="setting-tagline"
                className="block text-xs font-medium text-[#181817]"
              >
                Footer Brand Description
              </label>
              <textarea
                id="setting-tagline"
                rows={3}
                value={settings.storeTagline}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, storeTagline: e.target.value }))
                }
                className="mt-1 w-full border border-[#E5E3DC] bg-white p-3 text-xs text-[#181817]"
              />
            </div>

            <button
              type="submit"
              disabled={savingSettings}
              className="min-h-[48px] bg-[#181817] px-6 text-xs font-medium tracking-wide text-white hover:bg-[#333330] disabled:opacity-60"
            >
              {savingSettings ? "Saving Settings..." : "Save Store Settings"}
            </button>
          </form>
        )}

        {/* BinderPay SNAP Payment Gateway Health & Webhook Setup Card in Settings Tab */}
        {activeTab === "settings" && gatewayConfig && (
          <section className="mt-6 max-w-2xl space-y-4 border border-[#E5E3DC] bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#E5E3DC] pb-4">
              <div>
                <h2 className="font-display text-xl font-normal text-[#181817]">
                  BinderPay SNAP Payment Gateway
                </h2>
                <p className="mt-0.5 text-xs text-[#57534E]">
                  RSA-SHA256 SNAP BI integration for QRIS Dynamic, Virtual
                  Account, and Hosted Payment Links.
                </p>
              </div>
              <span
                className={`px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                  gatewayConfig.configured
                    ? "bg-[#181817] text-white"
                    : "border border-[#881337] bg-[#FFF1F2] text-[#881337]"
                }`}
              >
                {gatewayConfig.configured
                  ? `Connected · ${gatewayConfig.env}`
                  : "Credentials Required"}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
              <div className="border border-[#E5E3DC] bg-[#FAFAFA] p-3">
                <dt className="text-[10px] uppercase tracking-wider text-[#57534E]">
                  Environment
                </dt>
                <dd className="mt-1 font-semibold uppercase text-[#181817]">
                  {gatewayConfig.env}
                </dd>
              </div>
              <div className="border border-[#E5E3DC] bg-[#FAFAFA] p-3">
                <dt className="text-[10px] uppercase tracking-wider text-[#57534E]">
                  Partner ID
                </dt>
                <dd className="mt-1 font-mono font-semibold text-[#181817]">
                  {gatewayConfig.partnerIdMasked || "Not set"}
                </dd>
              </div>
              <div className="border border-[#E5E3DC] bg-[#FAFAFA] p-3">
                <dt className="text-[10px] uppercase tracking-wider text-[#57534E]">
                  Enabled Channels
                </dt>
                <dd className="mt-1 font-semibold text-[#181817]">
                  {gatewayConfig.channels.length} active
                </dd>
              </div>
            </dl>

            {!gatewayConfig.configured && (
              <div className="border border-[#881337] bg-[#FFF1F2] p-3.5 text-xs text-[#881337]">
                <p className="font-semibold">
                  Missing Environment Variables:{" "}
                  <code className="font-mono">
                    {gatewayConfig.missingEnvVars.join(", ")}
                  </code>
                </p>
                <p className="mt-1 text-[#181817]">
                  Tambahkan variabel tersebut ke{" "}
                  <code className="font-mono">.env.local</code> (lokal) dan
                  Vercel Project Settings → Environment Variables, lalu
                  redeploy.
                </p>
              </div>
            )}

            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-[#181817]">
                Webhook Callback URLs (daftar di Dashboard BinderPay)
              </p>
              {(
                [
                  {
                    key: "unified",
                    label: "Unified Callback (VA + QRIS + Link)",
                    url: gatewayConfig.callbackUrls.unified,
                  },
                  {
                    key: "va",
                    label: "Virtual Account Callback",
                    url: gatewayConfig.callbackUrls.va,
                  },
                  {
                    key: "qris",
                    label: "QRIS Callback",
                    url: gatewayConfig.callbackUrls.qris,
                  },
                  {
                    key: "link",
                    label: "Payment Link Webhook",
                    url: gatewayConfig.callbackUrls.paymentLink,
                  },
                ] as const
              ).map((item) => (
                <div
                  key={item.key}
                  className="flex flex-col gap-1.5 border border-[#E5E3DC] bg-[#FAFAFA] p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[#57534E]">
                      {item.label}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-[#181817]">
                      {item.url}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleCopyWebhookUrl(item.key, item.url)}
                    className="min-h-[36px] shrink-0 border border-[#181817] bg-white px-3 text-[11px] font-medium text-[#181817] hover:bg-[#181817] hover:text-white"
                  >
                    {copiedUrlKey === item.key ? "Copied" : "Copy URL"}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      {/* Create / Edit Product Modal (Uploads + SQLite Persistence) */}
      {editorState.open && (
        <SellerStudioModal
          editingProduct={editorState.editingProduct}
          mode="admin"
          onPublish={handleProductSaved}
          onClose={() => setEditorState({ open: false, editingProduct: null })}
        />
      )}

      {/* Inspect 2D / 3D Product Preview Modal */}
      {inspectingProduct && inspectModal && (
        <ProductDetailModal
          key={inspectModal.mode}
          product={inspectingProduct}
          relatedProducts={products
            .filter((p) => p.id !== inspectingProduct.id)
            .slice(0, 3)}
          previewsById={previewsById}
          initialMode={inspectModal.mode}
          isSaved={false}
          onSelectSize={(pid, size) =>
            setProducts((prev) =>
              prev.map((p) => (p.id === pid ? { ...p, selectedSize: size } : p))
            )
          }
          onAddToBag={() =>
            flashStatus(`Previewed "${inspectingProduct.title}" in Admin.`)
          }
          onToggleWishlist={() => {}}
          onSelectRelated={(nextId) =>
            setInspectModal({ productId: nextId, mode: inspectModal.mode })
          }
          onPreviewsBuilt={(pid, built) =>
            setPreviewsById((prev) => ({ ...prev, [pid]: built }))
          }
          onClose={() => setInspectModal(null)}
        />
      )}
    </div>
  );
}
