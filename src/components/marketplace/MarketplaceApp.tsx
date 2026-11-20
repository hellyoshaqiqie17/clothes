"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatIDR } from "@/data/catalogProducts";
import { preloadGarmentGlb } from "@/lib/garmentGlbLoader";
import { buildGarmentTextures } from "@/lib/garmentTextureBuilder";
import BagDrawer from "@/components/marketplace/BagDrawer";
import ProductCard from "@/components/marketplace/ProductCard";
import ProductDetailModal from "@/components/marketplace/ProductDetailModal";
import SellerStudioModal from "@/components/marketplace/SellerStudioModal";
import TrackOrderModal from "@/components/marketplace/TrackOrderModal";
import WishlistDrawer from "@/components/marketplace/WishlistDrawer";
import type {
  BagItem,
  CatalogProduct,
  CheckoutCustomer,
  CollectionTag,
  GarmentCut,
  HeroSlide,
  ProductPreviews,
  StoreOrder,
  StoreSettings,
  StorefrontBootstrap,
} from "@/types/catalog";

const GarmentViewer3D = dynamic(
  () => import("@/components/marketplace/GarmentViewer3D"),
  {
    ssr: false,
    loading: () => null,
  }
);

type CollectionFilter = "all" | CollectionTag | "published";
type CategoryFilter = "all" | "top" | "bottom";
type SilhouetteGroup =
  | "all"
  | "tees"
  | "knitwear"
  | "pullovers"
  | "outerwear"
  | "denim"
  | "utility";
type PriceFilter = "all" | "under-600k" | "600k-1m" | "over-1m";
type SortOrder = "newest" | "price-asc" | "price-desc";
type FeaturedTab = "featured" | CollectionTag;

const SILHOUETTE_CUTS: Record<Exclude<SilhouetteGroup, "all">, GarmentCut[]> = {
  tees: ["tee", "longsleeve"],
  knitwear: ["knit"],
  pullovers: ["hoodie"],
  outerwear: ["jacket"],
  denim: ["baggy-denim", "trouser"],
  utility: ["cargo", "shorts"],
};

const SILHOUETTE_META: {
  id: Exclude<SilhouetteGroup, "all">;
  label: string;
  subtitle: string;
}[] = [
  { id: "tees", label: "Tees & Tops", subtitle: "Heavyweight cotton" },
  { id: "knitwear", label: "Knitwear", subtitle: "Open-gauge weave" },
  { id: "pullovers", label: "Pullovers", subtitle: "Washed fleece" },
  { id: "outerwear", label: "Outerwear", subtitle: "Wool twill overshirts" },
  { id: "denim", label: "Denim", subtitle: "Baggy & straight cut" },
  { id: "utility", label: "Cargo & Shorts", subtitle: "Ripstop & twill" },
];

function matchesPriceRange(price: number, range: PriceFilter): boolean {
  if (range === "under-600k") return price < 600000;
  if (range === "600k-1m") return price >= 600000 && price <= 1000000;
  if (range === "over-1m") return price > 1000000;
  return true;
}

interface MarketplaceAppProps {
  initialData: StorefrontBootstrap;
}

export default function MarketplaceApp({ initialData }: MarketplaceAppProps) {
  const [products, setProducts] = useState<CatalogProduct[]>(initialData.products);
  const [dbHeroSlides, setDbHeroSlides] = useState<HeroSlide[]>(
    initialData.heroSlides
  );
  const [settings, setSettings] = useState<StoreSettings>(initialData.settings);
  const [previewsById, setPreviewsById] = useState<Record<string, ProductPreviews>>({});

  const [showAnnouncement, setShowAnnouncement] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [wishlistOpen, setWishlistOpen] = useState(false);
  const [trackOrderState, setTrackOrderState] = useState<{
    open: boolean;
    orderId: string;
  }>({ open: false, orderId: "" });

  const [heroIndex, setHeroIndex] = useState(0);
  const [isHeroHovered, setIsHeroHovered] = useState(false);
  const [featuredTab, setFeaturedTab] = useState<FeaturedTab>("featured");

  // Entry gate: keep page hidden until initial 3D garment has painted its first frame
  const [hero3DReady, setHero3DReady] = useState(false);
  const [bootFallbackReady, setBootFallbackReady] = useState(false);
  const [curtainDismissed, setCurtainDismissed] = useState(false);

  const [collectionFilter, setCollectionFilter] = useState<CollectionFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [silhouetteFilter, setSilhouetteFilter] = useState<SilhouetteGroup>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const [activeModal, setActiveModal] = useState<{
    productId: string;
    initialMode: "2d" | "3d";
  } | null>(null);
  const [studioState, setStudioState] = useState<{
    open: boolean;
    editingProduct: CatalogProduct | null;
  }>({ open: false, editingProduct: null });

  const [bagItems, setBagItems] = useState<BagItem[]>(
    () => initialData.initialBag ?? []
  );
  const [wishlistIds, setWishlistIds] = useState<string[]>(
    () => initialData.initialWishlistIds ?? []
  );
  const sessionMountedRef = useRef(false);
  const [quickAddedId, setQuickAddedId] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const [newsletterEmail, setNewsletterEmail] = useState("");
  const [newsletterError, setNewsletterError] = useState<string | null>(null);
  const [newsletterSubscribed, setNewsletterSubscribed] = useState(false);
  const [newsletterSubmitting, setNewsletterSubmitting] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMsg(message);
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 3400);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  // Persist bag & wishlist to SQLite session automatically
  useEffect(() => {
    if (!sessionMountedRef.current) {
      sessionMountedRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      void fetch("/api/session", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bagItems, wishlistIds }),
      }).catch(() => {
        // silent background sync retry on next interaction
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [bagItems, wishlistIds]);

  // Lock background page scroll while any modal or drawer is open
  const anyOverlayOpen = Boolean(
    activeModal ||
      studioState.open ||
      bagOpen ||
      wishlistOpen ||
      trackOrderState.open
  );
  useEffect(() => {
    if (!anyOverlayOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [anyOverlayOpen]);

  // Re-sync live DB storefront data whenever tab regains focus (e.g. after editing in /admin)
  useEffect(() => {
    const refreshFromDb = async () => {
      try {
        const res = await fetch("/api/storefront", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as StorefrontBootstrap;
        setProducts(data.products);
        setDbHeroSlides(data.heroSlides);
        setSettings(data.settings);
        if (Array.isArray(data.initialBag)) setBagItems(data.initialBag);
        if (Array.isArray(data.initialWishlistIds)) {
          setWishlistIds(data.initialWishlistIds);
        }
      } catch {
        // silent background refresh failure
      }
    };

    const onFocus = () => {
      void refreshFromDb();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Start downloading the baked 3D GLB immediately in parallel with Three.js dynamic bundle
  useEffect(() => {
    preloadGarmentGlb();
  }, []);

  const siteReady = hero3DReady || bootFallbackReady || products.length === 0;

  // Lightweight sticky header elevation on scroll
  useEffect(() => {
    const onScroll = () => {
      const next = window.scrollY > 18;
      setIsScrolled((prev) => (prev === next ? prev : next));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // IntersectionObserver for smooth scroll-reveal animations
  useEffect(() => {
    if (!siteReady) return;
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-revealed)")
    );
    if (nodes.length === 0) return;

    if (
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      nodes.forEach((n) => n.classList.add("is-revealed"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -36px 0px" }
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, [
    siteReady,
    featuredTab,
    collectionFilter,
    categoryFilter,
    silhouetteFilter,
    priceFilter,
    searchQuery,
    sortOrder,
    products.length,
  ]);

  const scrollToSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const resetAllFilters = useCallback(() => {
    setCollectionFilter("all");
    setCategoryFilter("all");
    setSilhouetteFilter("all");
    setPriceFilter("all");
    setSearchQuery("");
    setSortOrder("newest");
  }, []);

  const jumpToCatalogWith = useCallback(
    (opts: {
      collection?: CollectionFilter;
      category?: CategoryFilter;
      silhouette?: SilhouetteGroup;
    }) => {
      setCollectionFilter(opts.collection ?? "all");
      setCategoryFilter(opts.category ?? "all");
      setSilhouetteFilter(opts.silhouette ?? "all");
      setPriceFilter("all");
      setMobileMenuOpen(false);
      scrollToSection("catalog");
    },
    [scrollToSection]
  );

  const counts = useMemo(() => {
    let top = 0;
    let bottom = 0;
    let newArrivals = 0;
    let bestSellers = 0;
    let limited = 0;
    let published = 0;
    const silhouette: Record<Exclude<SilhouetteGroup, "all">, number> = {
      tees: 0,
      knitwear: 0,
      pullovers: 0,
      outerwear: 0,
      denim: 0,
      utility: 0,
    };

    for (const p of products) {
      if (p.category === "top") top++;
      else bottom++;
      if (p.collection === "new-arrivals") newArrivals++;
      if (p.collection === "best-sellers") bestSellers++;
      if (p.collection === "limited") limited++;
      if (p.isUserPublished) published++;

      for (const [group, cuts] of Object.entries(SILHOUETTE_CUTS) as [
        Exclude<SilhouetteGroup, "all">,
        GarmentCut[]
      ][]) {
        if (cuts.includes(p.cut)) silhouette[group]++;
      }
    }

    return {
      all: products.length,
      top,
      bottom,
      newArrivals,
      bestSellers,
      limited,
      published,
      silhouette,
    };
  }, [products]);

  const heroSlides = useMemo(() => {
    const resolved = dbHeroSlides
      .map((slide) => {
        const product = products.find((p) => p.id === slide.productId);
        return product ? { ...slide, product } : null;
      })
      .filter((s): s is HeroSlide & { product: CatalogProduct } => Boolean(s));

    if (resolved.length > 0) return resolved;

    return products.slice(0, 3).map((p, idx) => ({
      id: `fallback-slide-${idx + 1}`,
      productId: p.id,
      headlineStart: `${p.title}, `,
      headlineItalic: "crafted",
      headlineEnd: " for daily wear.",
      subtitle: p.description,
      ctaLabel: `Shop ${p.title}`,
      sortOrder: idx + 1,
      product: p,
    }));
  }, [dbHeroSlides, products]);

  const heroSlideProducts = useMemo(
    () => heroSlides.map((s) => s.product),
    [heroSlides]
  );

  const activeSlideIndex =
    heroSlides.length > 0 ? heroIndex % heroSlides.length : 0;
  const activeHeroSlide = heroSlides[activeSlideIndex] ?? null;
  const activeHeroProduct = activeHeroSlide?.product ?? products[0] ?? null;

  // Idle-warm remaining catalog textures in staggered slices so opening any 3D modal is instant
  useEffect(() => {
    if (!siteReady || products.length <= 1) return;
    let cancelled = false;
    const idleWin = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let idleId: number | null = null;
    let timerId: number | null = null;

    const warmQueue = [
      ...heroSlides.map((s) => s.product),
      ...products.filter((p) => !heroSlides.some((s) => s.product.id === p.id)),
    ];

    const warmAllCatalogTextures = async () => {
      for (const item of warmQueue) {
        if (cancelled) return;
        if (item.id === activeHeroProduct?.id) continue;
        try {
          await buildGarmentTextures(item);
        } catch {
          // ignore silent background warm glitch
        }
        await new Promise<void>((resolve) => {
          timerId = window.setTimeout(resolve, 220);
        });
      }
    };

    if (typeof idleWin.requestIdleCallback === "function") {
      idleId = idleWin.requestIdleCallback(() => void warmAllCatalogTextures(), {
        timeout: 1200,
      });
    } else {
      timerId = window.setTimeout(() => void warmAllCatalogTextures(), 300);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && typeof idleWin.cancelIdleCallback === "function") {
        idleWin.cancelIdleCallback(idleId);
      }
      if (timerId !== null) window.clearTimeout(timerId);
    };
  }, [siteReady, heroSlides, products, activeHeroProduct?.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBootFallbackReady(true);
    }, 5500);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!siteReady) return;
    const timer = window.setTimeout(() => {
      setCurtainDismissed(true);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [siteReady]);

  const pauseHeroWebGL = Boolean(activeModal || studioState.open);

  useEffect(() => {
    if (!siteReady || isHeroHovered || pauseHeroWebGL || heroSlides.length <= 1) {
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const timer = window.setInterval(() => {
      setHeroIndex((idx) => (idx + 1) % heroSlides.length);
    }, 7500);
    return () => window.clearInterval(timer);
  }, [siteReady, isHeroHovered, pauseHeroWebGL, heroSlides.length]);

  const handleHero3DReady = useCallback(() => {
    setHero3DReady(true);
  }, []);

  const stepHeroSlide = useCallback(
    (delta: number) => {
      if (heroSlides.length === 0) return;
      setHeroIndex((idx) => (idx + delta + heroSlides.length) % heroSlides.length);
    },
    [heroSlides.length]
  );

  const featuredProducts = useMemo(() => {
    if (featuredTab === "featured") {
      const pinned = products.filter((p) => p.isFeatured);
      return pinned.length >= 4 ? pinned.slice(0, 4) : products.slice(0, 4);
    }
    return products.filter((p) => p.collection === featuredTab).slice(0, 4);
  }, [products, featuredTab]);

  const visibleProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = products.filter((p) => {
      if (collectionFilter === "published" && !p.isUserPublished) return false;
      if (
        collectionFilter !== "all" &&
        collectionFilter !== "published" &&
        p.collection !== collectionFilter
      ) {
        return false;
      }
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (
        silhouetteFilter !== "all" &&
        !SILHOUETTE_CUTS[silhouetteFilter].includes(p.cut)
      ) {
        return false;
      }
      if (!matchesPriceRange(p.price, priceFilter)) return false;

      if (!q) return true;
      return (
        p.title.toLowerCase().includes(q) ||
        p.brand.toLowerCase().includes(q) ||
        p.colorTag.toLowerCase().includes(q) ||
        p.cut.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortOrder === "price-asc") return a.price - b.price;
      if (sortOrder === "price-desc") return b.price - a.price;
      return b.createdAt - a.createdAt;
    });
  }, [
    products,
    collectionFilter,
    categoryFilter,
    silhouetteFilter,
    priceFilter,
    searchQuery,
    sortOrder,
  ]);

  const activeFilterCount =
    (collectionFilter !== "all" ? 1 : 0) +
    (categoryFilter !== "all" ? 1 : 0) +
    (silhouetteFilter !== "all" ? 1 : 0) +
    (priceFilter !== "all" ? 1 : 0) +
    (searchQuery.trim() ? 1 : 0);

  const activeModalProduct = activeModal
    ? products.find((p) => p.id === activeModal.productId) ?? null
    : null;

  const relatedModalProducts = useMemo(() => {
    if (!activeModalProduct) return [];
    const others = products.filter((p) => p.id !== activeModalProduct.id);
    const sameCategory = others.filter(
      (p) => p.category === activeModalProduct.category
    );
    const diffCategory = others.filter(
      (p) => p.category !== activeModalProduct.category
    );
    return [...sameCategory, ...diffCategory].slice(0, 3);
  }, [activeModalProduct, products]);

  const savedProducts = useMemo(
    () => products.filter((p) => wishlistIds.includes(p.id)),
    [products, wishlistIds]
  );

  const handleSelectSize = useCallback((productId: string, size: string) => {
    setProducts((prev) =>
      prev.map((p) => (p.id === productId ? { ...p, selectedSize: size } : p))
    );
  }, []);

  const handleToggleWishlist = useCallback(
    (productId: string) => {
      const target = products.find((p) => p.id === productId);
      setWishlistIds((prev) => {
        const exists = prev.includes(productId);
        if (target) {
          showToast(
            exists
              ? `Removed ${target.title} from saved items.`
              : `Saved ${target.title} to your wishlist.`
          );
        }
        return exists
          ? prev.filter((id) => id !== productId)
          : [productId, ...prev];
      });
    },
    [products, showToast]
  );

  const handleAddToBag = useCallback(
    (product: CatalogProduct) => {
      const key = `${product.id}:${product.selectedSize}:${product.title}`;
      const thumb =
        product.mapping.frontImageUrl || previewsById[product.id]?.front2d || "";
      setBagItems((prev) => {
        const existing = prev.find((i) => i.key === key);
        if (existing) {
          return prev.map((i) =>
            i.key === key ? { ...i, quantity: i.quantity + 1 } : i
          );
        }
        return [
          ...prev,
          {
            key,
            productId: product.id,
            title: product.title,
            brand: product.brand,
            category: product.category,
            colorTag: product.colorTag,
            size: product.selectedSize,
            price: product.price,
            quantity: 1,
            thumbnailUrl: thumb,
          },
        ];
      });
      setQuickAddedId(product.id);
      showToast(`Added ${product.title} (${product.selectedSize}) to your bag.`);
      window.setTimeout(() => {
        setQuickAddedId((cur) => (cur === product.id ? null : cur));
      }, 1200);
    },
    [previewsById, showToast]
  );

  const handleSubmitOrder = useCallback(
    async (
      items: BagItem[],
      customer: CheckoutCustomer
    ): Promise<{
      order: StoreOrder | null;
      error?: string;
      fieldErrors?: Record<string, string>;
    }> => {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, customer }),
      });
      const data = (await res.json()) as {
        order?: StoreOrder;
        error?: string;
        fieldErrors?: Record<string, string>;
      };
      if (!res.ok || !data.order) {
        return {
          order: null,
          error: data.error || "Could not submit your order.",
          fieldErrors: data.fieldErrors,
        };
      }
      showToast(`Order ${data.order.id} recorded.`);
      return { order: data.order };
    },
    [showToast]
  );

  const handlePublishProduct = useCallback(
    (product: CatalogProduct, builtPreviews: ProductPreviews | null) => {
      setProducts((prev) => {
        const exists = prev.some((p) => p.id === product.id);
        if (exists) {
          return prev.map((p) => (p.id === product.id ? product : p));
        }
        return [product, ...prev];
      });

      if (builtPreviews) {
        setPreviewsById((prev) => ({ ...prev, [product.id]: builtPreviews }));
      } else {
        setPreviewsById((prev) => {
          const copy = { ...prev };
          delete copy[product.id];
          return copy;
        });
      }

      setStudioState({ open: false, editingProduct: null });
      showToast(`Published "${product.title}" to the store catalog.`);
      setActiveModal({ productId: product.id, initialMode: "3d" });
    },
    [showToast]
  );

  const handlePreviewsBuilt = useCallback(
    (productId: string, next: ProductPreviews) => {
      setPreviewsById((prev) => {
        const existing = prev[productId];
        if (
          existing &&
          existing.extractedHex === next.extractedHex &&
          existing.front2d === next.front2d &&
          existing.back2d === next.back2d
        ) {
          return prev;
        }
        return { ...prev, [productId]: next };
      });
    },
    []
  );

  const handleNewsletterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newsletterEmail.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setNewsletterError("Enter a valid email address to subscribe.");
      return;
    }
    setNewsletterError(null);
    setNewsletterSubmitting(true);
    try {
      const res = await fetch("/api/newsletter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const data = (await res.json()) as { error?: string; alreadySubscribed?: boolean };
      if (!res.ok) {
        setNewsletterError(data.error || "Could not save subscription.");
        return;
      }
      setNewsletterSubscribed(true);
      setNewsletterEmail("");
      showToast(
        data.alreadySubscribed
          ? "This email is already subscribed."
          : "Subscribed to Meridian drop alerts."
      );
    } catch {
      setNewsletterError("Network error while subscribing.");
    } finally {
      setNewsletterSubmitting(false);
    }
  };

  const bagCount = bagItems.reduce((sum, item) => sum + item.quantity, 0);

  const filterSidebarContent = (
    <div className="space-y-6">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#57534E]">
          Collection
        </h3>
        <ul className="mt-2.5 space-y-1">
          {(
            [
              { id: "all", label: "All Clothing", count: counts.all },
              {
                id: "new-arrivals",
                label: "New Arrivals",
                count: counts.newArrivals,
              },
              {
                id: "best-sellers",
                label: "Best Sellers",
                count: counts.bestSellers,
              },
              { id: "limited", label: "Limited Drop", count: counts.limited },
            ] as const
          ).map((item) => {
            const active = collectionFilter === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setCollectionFilter(item.id)}
                  aria-pressed={active}
                  className={`flex min-h-[40px] w-full items-center justify-between px-3 py-1.5 text-left text-xs transition-colors ${
                    active
                      ? "bg-[#181817] font-semibold text-white"
                      : "text-[#181817] hover:bg-[#F5F5F4]"
                  }`}
                >
                  <span>
                    {item.label}{" "}
                    <span
                      className={`text-[11px] tabular-nums ${
                        active ? "text-[#D6D3CD]" : "text-[#57534E]"
                      }`}
                    >
                      ({item.count})
                    </span>
                  </span>
                  {active && (
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/90">
                      Active
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-[#E5E3DC] pt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#57534E]">
          Category
        </h3>
        <ul className="mt-2.5 space-y-1">
          {(
            [
              { id: "all", label: "All Categories", count: counts.all },
              { id: "top", label: "Tops & Shirts", count: counts.top },
              { id: "bottom", label: "Bottoms & Pants", count: counts.bottom },
            ] as const
          ).map((item) => {
            const active = categoryFilter === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setCategoryFilter(item.id)}
                  aria-pressed={active}
                  className={`flex min-h-[38px] w-full items-center justify-between px-3 py-1 text-left text-xs transition-colors ${
                    active
                      ? "bg-[#181817] font-semibold text-white"
                      : "text-[#181817] hover:bg-[#F5F5F4]"
                  }`}
                >
                  <span>{item.label}</span>
                  <span
                    className={`text-[11px] tabular-nums ${
                      active ? "text-[#D6D3CD]" : "text-[#57534E]"
                    }`}
                  >
                    {item.count}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-[#E5E3DC] pt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#57534E]">
          Fit &amp; Style
        </h3>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {(
            [
              { id: "all", label: "All" },
              { id: "tees", label: "Tees" },
              { id: "knitwear", label: "Knitwear" },
              { id: "pullovers", label: "Pullovers" },
              { id: "outerwear", label: "Outerwear" },
              { id: "denim", label: "Denim" },
              { id: "utility", label: "Cargo & Shorts" },
            ] as const
          ).map((item) => {
            const active = silhouetteFilter === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSilhouetteFilter(item.id)}
                aria-pressed={active}
                className={`min-h-[36px] border px-2.5 text-xs transition-colors ${
                  active
                    ? "border-[#181817] bg-[#181817] font-medium text-white"
                    : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[#E5E3DC] pt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#57534E]">
          Price Range
        </h3>
        <ul className="mt-2.5 space-y-1">
          {(
            [
              { id: "all", label: "All Prices" },
              { id: "under-600k", label: "Under Rp 600.000" },
              { id: "600k-1m", label: "Rp 600.000 to Rp 1.000.000" },
              { id: "over-1m", label: "Over Rp 1.000.000" },
            ] as const
          ).map((item) => {
            const active = priceFilter === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setPriceFilter(item.id)}
                  aria-pressed={active}
                  className={`flex min-h-[38px] w-full items-center justify-between px-3 py-1 text-left text-xs tabular-nums transition-colors ${
                    active
                      ? "bg-[#181817] font-semibold text-white"
                      : "text-[#181817] hover:bg-[#F5F5F4]"
                  }`}
                >
                  <span>{item.label}</span>
                  {active && (
                    <span className="text-[10px] font-medium uppercase tracking-wider text-white/90">
                      Active
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {activeFilterCount > 0 && (
        <div className="border-t border-[#E5E3DC] pt-4">
          <button
            type="button"
            onClick={resetAllFilters}
            className="min-h-[44px] w-full border border-[#181817] bg-white px-3 text-xs font-medium text-[#181817] transition-colors hover:bg-[#F5F5F5]"
          >
            Reset Filters ({activeFilterCount})
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-[100dvh] flex-col bg-white text-[#181817]">
      {/* Entry Preloader Curtain: waits until 3D garment paints its first frame */}
      {!curtainDismissed && (
        <div
          aria-busy={!siteReady}
          aria-label="Preparing Meridian store"
          className={`fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white transition-opacity duration-300 ${
            siteReady ? "pointer-events-none opacity-0" : "opacity-100"
          }`}
        >
          <span className="font-display text-3xl font-medium tracking-tight text-[#181817] sm:text-4xl">
            {settings.storeName}
          </span>
          <div className="mt-5 h-[1.5px] w-32 overflow-hidden bg-[#E5E3DC]">
            <div className="meridian-preload-bar h-full w-14 bg-[#181817]" />
          </div>
        </div>
      )}

      {/* Announcement Bar (Live from DB Settings) */}
      {showAnnouncement && settings.announcementText && (
        <div className="bg-[#181817] text-white">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-3 px-4 py-2 sm:px-6 lg:px-8">
            <p className="text-xs font-normal tracking-wide text-[#F5F5F4]">
              {settings.announcementText}
            </p>
            <button
              type="button"
              onClick={() => setShowAnnouncement(false)}
              aria-label="Dismiss announcement bar"
              className="flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center text-sm text-[#D6D3CD] hover:text-white"
            >
              ×
            </button>
          </div>
        </div>
      )}

      {/* Storefront Header */}
      <header
        className={`sticky top-0 z-30 border-b border-[#E5E3DC] backdrop-blur-md transition-[background-color,box-shadow] duration-300 ${
          isScrolled
            ? "bg-white/95 shadow-[0_6px_24px_-12px_rgba(24,24,23,0.12)]"
            : "bg-white/90 shadow-none"
        }`}
      >
        <div className="mx-auto flex h-[68px] max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={() => {
              resetAllFilters();
              setActiveModal(null);
              setStudioState({ open: false, editingProduct: null });
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            className="flex min-h-[44px] items-center gap-2.5 text-left"
            aria-label={`${settings.storeName} Home`}
          >
            <span className="font-display text-2xl font-medium tracking-tight text-[#181817]">
              {settings.storeName}
            </span>
          </button>

          <nav
            aria-label="Main storefront navigation"
            className="hidden items-center gap-1 lg:flex"
          >
            <button
              type="button"
              onClick={() => jumpToCatalogWith({ collection: "all" })}
              className="min-h-[44px] px-3 text-[13px] font-medium text-[#181817] transition-colors hover:text-[#881337]"
            >
              Shop All
            </button>
            <button
              type="button"
              onClick={() => jumpToCatalogWith({ collection: "new-arrivals" })}
              className="min-h-[44px] px-3 text-[13px] font-medium text-[#181817] transition-colors hover:text-[#881337]"
            >
              New Arrivals
            </button>
            <button
              type="button"
              onClick={() => jumpToCatalogWith({ collection: "best-sellers" })}
              className="min-h-[44px] px-3 text-[13px] font-medium text-[#181817] transition-colors hover:text-[#881337]"
            >
              Best Sellers
            </button>
            <button
              type="button"
              onClick={() => scrollToSection("categories")}
              className="min-h-[44px] px-3 text-[13px] font-medium text-[#181817] transition-colors hover:text-[#881337]"
            >
              Categories
            </button>
          </nav>

          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => {
                scrollToSection("catalog");
                window.setTimeout(() => searchInputRef.current?.focus(), 250);
              }}
              aria-label="Search clothing catalog"
              className="hidden min-h-[44px] min-w-[44px] items-center justify-center border border-transparent text-[#181817] transition-colors hover:border-[#E5E3DC] hover:bg-[#F5F5F5] sm:inline-flex"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => setTrackOrderState({ open: true, orderId: "" })}
              aria-label="Track your order"
              title="Track Order"
              className="hidden min-h-[44px] min-w-[44px] items-center justify-center border border-transparent text-[#181817] transition-colors hover:border-[#E5E3DC] hover:bg-[#F5F5F5] sm:inline-flex"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <path d="M16.5 9.4 7.55 4.24" />
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <path d="M3.29 7 12 12l8.71-5" />
                <path d="M12 22V12" />
              </svg>
            </button>

            <button
              type="button"
              onClick={() => setWishlistOpen(true)}
              aria-label={`Open saved items (${wishlistIds.length})`}
              className="relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center border border-transparent text-[#181817] transition-colors hover:border-[#E5E3DC] hover:bg-[#F5F5F5]"
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill={wishlistIds.length > 0 ? "#881337" : "none"}
                stroke={wishlistIds.length > 0 ? "#881337" : "currentColor"}
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
              </svg>
              {wishlistIds.length > 0 && (
                <span className="absolute right-1 top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-[#881337] px-1 text-[10px] font-bold tabular-nums text-white">
                  {wishlistIds.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setBagOpen(true)}
              aria-label={`Open shopping bag with ${bagCount} items`}
              className="inline-flex min-h-[44px] items-center gap-1.5 bg-[#181817] px-3 text-xs font-medium tracking-wide tabular-nums text-white transition-colors hover:bg-[#333330] sm:gap-2 sm:px-4"
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
                <path d="M6 8h12l1 12H5L6 8Z" strokeLinejoin="round" />
                <path d="M9 8V6a3 3 0 0 1 6 0v2" />
              </svg>
              <span>Bag ({bagCount})</span>
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              aria-controls="mobile-storefront-nav"
              className="min-h-[44px] min-w-[44px] border border-[#E5E3DC] bg-white px-3 text-xs font-medium text-[#181817] lg:hidden"
            >
              {mobileMenuOpen ? "Close" : "Menu"}
            </button>
          </div>
        </div>

        {/* Mobile Navigation */}
        {mobileMenuOpen && (
          <nav
            id="mobile-storefront-nav"
            aria-label="Mobile storefront navigation"
            className="flex flex-col border-t border-[#E5E3DC] bg-white px-4 py-2 lg:hidden"
          >
            <button
              type="button"
              onClick={() => jumpToCatalogWith({ collection: "all" })}
              className="min-h-[44px] border-b border-[#F2F0EB] text-left text-sm font-medium text-[#181817]"
            >
              Shop All ({counts.all})
            </button>
            <button
              type="button"
              onClick={() => jumpToCatalogWith({ collection: "new-arrivals" })}
              className="min-h-[44px] border-b border-[#F2F0EB] text-left text-sm font-medium text-[#181817]"
            >
              New Arrivals ({counts.newArrivals})
            </button>
            <button
              type="button"
              onClick={() => jumpToCatalogWith({ collection: "best-sellers" })}
              className="min-h-[44px] border-b border-[#F2F0EB] text-left text-sm font-medium text-[#181817]"
            >
              Best Sellers ({counts.bestSellers})
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                scrollToSection("categories");
              }}
              className="min-h-[44px] border-b border-[#F2F0EB] text-left text-sm font-medium text-[#181817]"
            >
              Shop by Category
            </button>
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                setTrackOrderState({ open: true, orderId: "" });
              }}
              className="min-h-[44px] text-left text-sm font-medium text-[#181817]"
            >
              Track Order
            </button>
          </nav>
        )}
      </header>

      <main className="flex-1">
        {/* SECTION 1: Editorial Clothing Hero Carousel + VNYL-Style Bottom Banner Bar */}
        {activeHeroSlide && activeHeroProduct && (
          <section
            aria-label="Featured clothing showcase"
            onMouseEnter={() => setIsHeroHovered(true)}
            onMouseLeave={() => setIsHeroHovered(false)}
            className="bg-white"
          >
            <div className="mx-auto max-w-[1440px] px-4 py-10 sm:px-6 lg:px-8 lg:py-14">
              <div className="grid grid-cols-1 items-center gap-8 lg:grid-cols-12 lg:gap-12">
                <div className="flex flex-col justify-between lg:col-span-6">
                  <div key={activeHeroSlide.id} className="meridian-hero-enter">
                    <h1 className="font-display text-4xl font-normal leading-[1.06] tracking-[-0.02em] text-[#181817] sm:text-5xl lg:text-[58px]">
                      {activeHeroSlide.headlineStart}
                      <span className="italic">
                        {activeHeroSlide.headlineItalic}
                      </span>
                      {activeHeroSlide.headlineEnd}
                    </h1>
                    <p className="mt-5 max-w-lg text-sm leading-relaxed text-[#57534E] sm:text-[15px]">
                      {activeHeroSlide.subtitle}
                    </p>

                    <div className="mt-7 flex flex-wrap items-center gap-3">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveModal({
                            productId: activeHeroProduct.id,
                            initialMode: "3d",
                          })
                        }
                        className="min-h-[48px] bg-[#181817] px-7 text-xs font-medium tracking-wide text-white transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#333330]"
                      >
                        {activeHeroSlide.ctaLabel}
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollToSection("catalog")}
                        className="min-h-[48px] border border-[#181817] bg-white px-6 text-xs font-medium tracking-wide text-[#181817] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#F5F5F5]"
                      >
                        Shop All Clothing
                      </button>
                    </div>
                  </div>

                  <div
                    data-reveal
                    style={{ "--reveal-delay": "120ms" } as React.CSSProperties}
                    className="mt-10 grid grid-cols-1 gap-5 border-t border-[#E5E3DC] pt-6 sm:grid-cols-3"
                  >
                    <div>
                      <p className="text-xs font-semibold text-[#181817]">
                        Heavyweight Fabrics
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[#57534E]">
                        280gsm combed cotton, wool twill, and washed denim.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#181817]">
                        360° Garment View
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[#57534E]">
                        Rotate every piece to inspect cut, drape, and back details.
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-[#181817]">
                        {settings.exchangePolicyDays}-Day Size Exchange
                      </p>
                      <p className="mt-1 text-xs leading-relaxed text-[#57534E]">
                        Simple unworn exchanges if the fit is not right.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Right Interactive 3D Garment (Pure Unobstructed on White, kept alive & paused while modal open) */}
                <div
                  data-reveal="scale"
                  style={{ "--reveal-delay": "90ms" } as React.CSSProperties}
                  className="flex flex-col bg-transparent lg:col-span-6"
                >
                  <div className="relative h-[380px] w-full bg-transparent sm:h-[460px]">
                    <GarmentViewer3D
                      product={activeHeroProduct}
                      anglePreset="three-quarter"
                      paused={pauseHeroWebGL}
                      enableZoom={false}
                      preloadProducts={heroSlideProducts}
                      onPreviewsBuilt={handlePreviewsBuilt}
                      onReady={handleHero3DReady}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Full-Width Refined Bottom Banner Carousel Switcher */}
            {heroSlides.length > 0 && (
              <div className="border-t border-[#E5E3DC] bg-white">
                <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-2 sm:px-6 lg:px-8">
                  <div className="flex flex-wrap items-center gap-4 sm:gap-6">
                    <div
                      className="flex items-center gap-2"
                      role="tablist"
                      aria-label="Hero showcase slides"
                    >
                      {heroSlides.map((slide, idx) => {
                        const active = idx === activeSlideIndex;
                        return (
                          <button
                            key={slide.id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            aria-label={`Slide ${idx + 1}: ${slide.product.title}`}
                            onClick={() => setHeroIndex(idx)}
                            className="group flex min-h-[44px] items-center px-0.5"
                          >
                            <span
                              className={`block h-[2px] w-10 transition-colors sm:w-14 ${
                                active
                                  ? "bg-[#181817]"
                                  : "bg-[#D6D3CD] group-hover:bg-[#57534E]"
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setActiveModal({
                          productId: activeHeroProduct.id,
                          initialMode: "3d",
                        })
                      }
                      className="hidden min-h-[44px] items-center gap-2 text-left text-xs text-[#57534E] hover:text-[#181817] sm:inline-flex"
                    >
                      <span className="font-semibold text-[#181817]">
                        {activeHeroProduct.title}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">
                        {formatIDR(activeHeroProduct.price)}
                      </span>
                    </button>
                  </div>

                  <div className="flex items-center gap-4">
                    <span
                      aria-live="polite"
                      className="flex items-baseline gap-1.5 text-xs tracking-[0.14em] tabular-nums"
                    >
                      <span className="font-semibold text-[#181817]">
                        {String(activeSlideIndex + 1).padStart(2, "0")}
                      </span>
                      <span className="text-[#57534E]" aria-hidden="true">
                        /
                      </span>
                      <span className="text-[#57534E]">
                        {String(heroSlides.length).padStart(2, "0")}
                      </span>
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => stepHeroSlide(-1)}
                        aria-label="Previous hero garment"
                        className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E5E3DC] bg-white text-[#181817] transition-colors hover:border-[#181817] hover:bg-[#181817] hover:text-white"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          aria-hidden="true"
                        >
                          <path d="M19 12H5" />
                          <path d="m11 18-6-6 6-6" />
                        </svg>
                      </button>

                      <button
                        type="button"
                        onClick={() => stepHeroSlide(1)}
                        aria-label="Next hero garment"
                        className="flex h-11 w-11 items-center justify-center rounded-full border border-[#E5E3DC] bg-white text-[#181817] transition-colors hover:border-[#181817] hover:bg-[#181817] hover:text-white"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          aria-hidden="true"
                        >
                          <path d="M5 12h14" />
                          <path d="m13 6 6 6-6 6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {/* SECTION 2: New & Featured */}
        <section className="border-y border-[#E5E3DC] bg-white py-12 lg:py-16">
          <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-8">
            <div
              data-reveal
              className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"
            >
              <h2 className="font-display text-3xl font-normal tracking-[-0.015em] text-[#181817] sm:text-4xl">
                New &amp; Featured
              </h2>

              <div
                role="tablist"
                aria-label="Featured collection tabs"
                className="flex flex-wrap items-center gap-1.5"
              >
                {(
                  [
                    { id: "featured", label: "Featured" },
                    { id: "new-arrivals", label: "New Arrivals" },
                    { id: "best-sellers", label: "Best Sellers" },
                    { id: "limited", label: "Limited Drop" },
                  ] as const
                ).map((tab) => {
                  const active = featuredTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFeaturedTab(tab.id)}
                      className={`min-h-[40px] border px-3.5 text-xs font-medium transition-colors ${
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
            </div>

            <div className="mt-7 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {featuredProducts.map((product, idx) => (
                <div
                  key={`${featuredTab}-${product.id}`}
                  data-reveal="scale"
                  style={
                    {
                      "--reveal-delay": `${Math.min(idx * 70, 280)}ms`,
                    } as React.CSSProperties
                  }
                  className="flex flex-col"
                >
                  <ProductCard
                    product={product}
                    preview={previewsById[product.id]}
                    isSaved={wishlistIds.includes(product.id)}
                    wasAdded={quickAddedId === product.id}
                    onSelectSize={handleSelectSize}
                    onOpenDetail={(id, mode) =>
                      setActiveModal({ productId: id, initialMode: mode })
                    }
                    onToggleWishlist={handleToggleWishlist}
                    onQuickAdd={handleAddToBag}
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* SECTION 3: Shop by Category */}
        <section
          id="categories"
          className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16"
        >
          <div
            data-reveal
            className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"
          >
            <h2 className="font-display text-3xl font-normal tracking-[-0.015em] text-[#181817] sm:text-4xl">
              Shop by Category
            </h2>
            <button
              type="button"
              onClick={() => jumpToCatalogWith({ collection: "all" })}
              className="min-h-[40px] self-start text-xs font-medium text-[#181817] underline underline-offset-4 hover:text-[#881337] sm:self-auto"
            >
              View all clothing →
            </button>
          </div>

          <div className="mt-7 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
            {SILHOUETTE_META.map((tile, idx) => {
              const matchingProduct = products.find((p) =>
                SILHOUETTE_CUTS[tile.id].includes(p.cut)
              );
              const sampleThumb = matchingProduct
                ? matchingProduct.mapping.frontImageUrl ||
                  previewsById[matchingProduct.id]?.front2d
                : undefined;
              const pieceCount = counts.silhouette[tile.id];
              return (
                <button
                  key={tile.id}
                  type="button"
                  data-reveal="scale"
                  style={
                    {
                      "--reveal-delay": `${Math.min(idx * 55, 300)}ms`,
                    } as React.CSSProperties
                  }
                  onClick={() => jumpToCatalogWith({ silhouette: tile.id })}
                  className="group flex flex-col border border-[#E5E3DC] bg-white text-left transition-all duration-300 hover:-translate-y-1 hover:border-[#181817] hover:shadow-[0_12px_28px_-14px_rgba(24,24,23,0.16)]"
                >
                  <div className="aspect-square w-full overflow-hidden bg-[#EFEFEB] p-2">
                    {sampleThumb ? (
                      <Image
                        src={sampleThumb}
                        alt={tile.label}
                        width={240}
                        height={240}
                        unoptimized
                        className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-[#57534E]">
                        {tile.label}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col justify-between border-t border-[#E5E3DC] p-3.5">
                    <div>
                      <p className="text-sm font-semibold text-[#181817] group-hover:underline">
                        {tile.label}
                      </p>
                      <p className="mt-0.5 text-xs text-[#57534E]">
                        {tile.subtitle}
                      </p>
                    </div>
                    <p className="mt-2.5 text-[11px] font-medium tabular-nums text-[#57534E]">
                      {pieceCount} {pieceCount === 1 ? "item" : "items"} →
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* SECTION 4: Brand Craftsmanship Banner */}
        <section className="bg-[#181817] text-white">
          <div className="mx-auto grid max-w-[1440px] grid-cols-1 items-center gap-8 px-4 py-14 sm:px-6 lg:grid-cols-12 lg:px-8 lg:py-16">
            <div data-reveal="left" className="lg:col-span-7">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#D6D3CD]">
                The Meridian Standard
              </p>
              <h2 className="mt-2 font-display text-3xl font-normal tracking-[-0.015em] text-white sm:text-4xl">
                Everyday garments, tailored to wear on repeat.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-[#D6D3CD]">
                Heavyweight 280gsm combed cotton, structured wool twill, and washed denim silhouettes crafted with double-needle construction and relaxed architectural cuts.
              </p>
            </div>

            <div
              data-reveal
              style={{ "--reveal-delay": "110ms" } as React.CSSProperties}
              className="flex flex-col gap-4 lg:col-span-5"
            >
              <div className="grid grid-cols-3 gap-3 border border-white/15 bg-white/[0.04] p-4">
                <div>
                  <p className="text-xs font-semibold text-white">280+ GSM</p>
                  <p className="mt-0.5 text-[11px] text-[#D6D3CD]">Heavy combed cotton</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">360° View</p>
                  <p className="mt-0.5 text-[11px] text-[#D6D3CD]">Inspect every drape</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-white">{settings.exchangePolicyDays} Days</p>
                  <p className="mt-0.5 text-[11px] text-[#D6D3CD]">Size exchange</p>
                </div>
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => scrollToSection("catalog")}
                  className="min-h-[48px] w-full bg-white px-6 text-xs font-semibold tracking-wide text-[#181817] transition-all duration-200 hover:-translate-y-0.5 hover:bg-[#F5F5F4]"
                >
                  Explore All Clothing →
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 5: Full Clothing Catalog with Left Filter Sidebar */}
        <section
          id="catalog"
          aria-label="Full clothing catalog"
          className="mx-auto max-w-[1440px] px-4 py-12 sm:px-6 lg:px-8 lg:py-16"
        >
          <div
            data-reveal
            className="flex flex-col justify-between gap-4 border-b border-[#E5E3DC] pb-6 md:flex-row md:items-end"
          >
            <h2 className="font-display text-3xl font-normal tracking-[-0.015em] text-[#181817] sm:text-4xl">
              All Clothing
            </h2>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1 sm:w-72">
                <label htmlFor="catalog-search" className="sr-only">
                  Search clothing by name, brand, fabric, or color
                </label>
                <input
                  ref={searchInputRef}
                  id="catalog-search"
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search tees, knits, denim..."
                  className="min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3.5 text-xs text-[#181817] placeholder:text-[#57534E]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setMobileFiltersOpen((v) => !v)}
                  aria-expanded={mobileFiltersOpen}
                  aria-controls="mobile-filter-panel"
                  className="min-h-[44px] border border-[#181817] bg-white px-3.5 text-xs font-medium text-[#181817] lg:hidden"
                >
                  Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
                </button>

                <label
                  htmlFor="catalog-sort"
                  className="hidden text-xs font-medium text-[#57534E] sm:inline"
                >
                  Sort
                </label>
                <select
                  id="catalog-sort"
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                  className="h-[44px] border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                >
                  <option value="newest">Newest</option>
                  <option value="price-asc">Price: Low to High</option>
                  <option value="price-desc">Price: High to Low</option>
                </select>
              </div>
            </div>
          </div>

          {mobileFiltersOpen && (
            <div
              id="mobile-filter-panel"
              className="mt-4 border border-[#E5E3DC] bg-white p-5 lg:hidden"
            >
              {filterSidebarContent}
            </div>
          )}

          <div className="mt-8 flex flex-col gap-8 lg:flex-row lg:items-start">
            <aside
              data-reveal="left"
              aria-label="Catalog filters"
              className="hidden w-[250px] shrink-0 border border-[#E5E3DC] bg-white p-5 lg:sticky lg:top-[88px] lg:block"
            >
              {filterSidebarContent}
            </aside>

            <div className="min-w-0 flex-1">
              <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs tabular-nums text-[#57534E]">
                  Showing{" "}
                  <strong className="font-semibold text-[#181817]">
                    {visibleProducts.length}
                  </strong>{" "}
                  of{" "}
                  <strong className="font-semibold text-[#181817]">
                    {products.length}
                  </strong>{" "}
                  items
                </p>

                {activeFilterCount > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {collectionFilter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setCollectionFilter("all")}
                        className="inline-flex min-h-[32px] items-center gap-1.5 border border-[#181817] bg-white px-2.5 text-[11px] font-medium capitalize text-[#181817]"
                      >
                        {collectionFilter.replace("-", " ")} ×
                      </button>
                    )}
                    {categoryFilter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setCategoryFilter("all")}
                        className="inline-flex min-h-[32px] items-center gap-1.5 border border-[#181817] bg-white px-2.5 text-[11px] font-medium capitalize text-[#181817]"
                      >
                        {categoryFilter} ×
                      </button>
                    )}
                    {silhouetteFilter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setSilhouetteFilter("all")}
                        className="inline-flex min-h-[32px] items-center gap-1.5 border border-[#181817] bg-white px-2.5 text-[11px] font-medium capitalize text-[#181817]"
                      >
                        {silhouetteFilter} ×
                      </button>
                    )}
                    {priceFilter !== "all" && (
                      <button
                        type="button"
                        onClick={() => setPriceFilter("all")}
                        className="inline-flex min-h-[32px] items-center gap-1.5 border border-[#181817] bg-white px-2.5 text-[11px] font-medium text-[#181817]"
                      >
                        {priceFilter} ×
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      className="min-h-[32px] px-2 text-xs font-medium text-[#881337] underline"
                    >
                      Clear all
                    </button>
                  </div>
                )}
              </div>

              {visibleProducts.length === 0 ? (
                <div className="flex flex-col items-center justify-center border border-[#E5E3DC] bg-white px-6 py-16 text-center">
                  <p className="text-base font-semibold text-[#181817]">
                    {collectionFilter === "published" && !searchQuery
                      ? "No community pieces listed yet"
                      : "No items match your filters"}
                  </p>
                  <p className="mt-1.5 max-w-md text-xs leading-relaxed text-[#57534E]">
                    {collectionFilter === "published" && !searchQuery
                      ? "Upload a front photo or front and back photos to preview your piece in 3D and publish it directly to the catalog."
                      : "Try removing a filter or searching for another item."}
                  </p>
                  <div className="mt-5 flex flex-wrap justify-center gap-2">
                    {collectionFilter === "published" ? (
                      <button
                        type="button"
                        onClick={() =>
                          setStudioState({ open: true, editingProduct: null })
                        }
                        className="min-h-[44px] bg-[#181817] px-5 text-xs font-medium text-white hover:bg-[#333330]"
                      >
                        List Your First Piece
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={resetAllFilters}
                        className="min-h-[44px] bg-[#181817] px-5 text-xs font-medium text-white hover:bg-[#333330]"
                      >
                        Reset Filters
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
                  {visibleProducts.map((product, idx) => (
                    <div
                      key={product.id}
                      data-reveal="scale"
                      style={
                        {
                          "--reveal-delay": `${(idx % 3) * 65}ms`,
                        } as React.CSSProperties
                      }
                      className="flex flex-col"
                    >
                      <ProductCard
                        product={product}
                        preview={previewsById[product.id]}
                        isSaved={wishlistIds.includes(product.id)}
                        wasAdded={quickAddedId === product.id}
                        onSelectSize={handleSelectSize}
                        onOpenDetail={(id, mode) =>
                          setActiveModal({ productId: id, initialMode: mode })
                        }
                        onToggleWishlist={handleToggleWishlist}
                        onQuickAdd={handleAddToBag}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      {/* SECTION 6: Store Footer */}
      <footer className="border-t border-white/10 bg-[#181817] text-white">
        <div
          data-reveal
          className="mx-auto max-w-[1440px] px-4 py-14 sm:px-6 lg:px-8"
        >
          <div className="grid grid-cols-1 gap-10 md:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="font-display text-2xl font-medium tracking-tight text-white">
                {settings.storeName}
              </span>
              <p className="mt-3 text-xs leading-relaxed text-[#D6D3CD]">
                {settings.storeTagline}
              </p>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-white">
                Shop
              </h3>
              <ul className="mt-3 space-y-2 text-xs text-[#D6D3CD]">
                <li>
                  <button
                    type="button"
                    onClick={() => jumpToCatalogWith({ collection: "all" })}
                    className="hover:text-white hover:underline"
                  >
                    All Clothing ({counts.all})
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => jumpToCatalogWith({ collection: "new-arrivals" })}
                    className="hover:text-white hover:underline"
                  >
                    New Arrivals ({counts.newArrivals})
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => jumpToCatalogWith({ collection: "best-sellers" })}
                    className="hover:text-white hover:underline"
                  >
                    Best Sellers ({counts.bestSellers})
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => jumpToCatalogWith({ category: "top" })}
                    className="hover:text-white hover:underline"
                  >
                    Tops &amp; Shirts ({counts.top})
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => jumpToCatalogWith({ category: "bottom" })}
                    className="hover:text-white hover:underline"
                  >
                    Denim &amp; Trousers ({counts.bottom})
                  </button>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-white">
                Customer Care
              </h3>
              <ul className="mt-3 space-y-2 text-xs text-[#D6D3CD]">
                <li>
                  <button
                    type="button"
                    onClick={() => setTrackOrderState({ open: true, orderId: "" })}
                    className="hover:text-white hover:underline"
                  >
                    Track Your Order
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => setWishlistOpen(true)}
                    className="hover:text-white hover:underline"
                  >
                    Saved Items ({wishlistIds.length})
                  </button>
                </li>
                <li>
                  <button
                    type="button"
                    onClick={() => scrollToSection("categories")}
                    className="hover:text-white hover:underline"
                  >
                    Categories &amp; Sizing
                  </button>
                </li>
                <li className="pt-1 text-[11px] leading-relaxed text-[#D6D3CD]">
                  Free shipping on orders above{" "}
                  {formatIDR(settings.freeShippingThreshold)}.{" "}
                  {settings.exchangePolicyDays}-day unworn size exchange. Support:{" "}
                  {settings.supportEmail}
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-white">
                Newsletter
              </h3>
              <p className="mt-3 text-xs leading-relaxed text-[#D6D3CD]">
                Get early access to new drops and restocks.
              </p>

              {newsletterSubscribed ? (
                <div
                  role="status"
                  className="mt-4 border border-white/25 bg-white/10 p-3 text-xs text-white"
                >
                  You are subscribed to drop alerts.
                </div>
              ) : (
                <form
                  onSubmit={(e) => void handleNewsletterSubmit(e)}
                  noValidate
                  className="mt-4 space-y-2"
                >
                  <label htmlFor="newsletter-email" className="sr-only">
                    Email address for newsletter
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="newsletter-email"
                      type="email"
                      value={newsletterEmail}
                      onChange={(e) => {
                        setNewsletterEmail(e.target.value);
                        if (newsletterError) setNewsletterError(null);
                      }}
                      placeholder="you@domain.com"
                      className="min-h-[44px] flex-1 border border-white/25 bg-[#232321] px-3 text-xs text-white placeholder:text-[#D6D3CD]"
                    />
                    <button
                      type="submit"
                      disabled={newsletterSubmitting}
                      className="min-h-[44px] bg-[#881337] px-4 text-xs font-medium text-white transition-colors hover:bg-[#9F1239] disabled:opacity-60"
                    >
                      {newsletterSubmitting ? "Saving..." : "Subscribe"}
                    </button>
                  </div>
                  {newsletterError && (
                    <p role="alert" className="text-xs text-[#FDA4AF]">
                      {newsletterError}
                    </p>
                  )}
                </form>
              )}
            </div>
          </div>

          <div className="mt-12 flex flex-col items-start justify-between gap-2 border-t border-white/15 pt-6 text-xs text-[#D6D3CD] sm:flex-row sm:items-center">
            <p>
              © {new Date().getFullYear()} {settings.storeName} Clothing · All rights reserved.
            </p>
            <div className="flex items-center gap-4">
              <p>{settings.storeLocation}</p>
              <span aria-hidden="true" className="text-white/20">·</span>
              <Link href="/admin" className="text-xs text-[#D6D3CD]/60 hover:text-white hover:underline">
                Admin
              </Link>
            </div>
          </div>
        </div>
      </footer>

      {/* Bottom-Left Toast Notification */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 left-5 z-40 flex max-w-sm items-center gap-3 border border-white/15 bg-[#181817] px-4 py-3 text-xs text-white shadow-2xl"
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full bg-[#FDA4AF]"
            aria-hidden="true"
          />
          <p className="flex-1 leading-snug">{toastMsg}</p>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            aria-label="Dismiss notification"
            className="flex min-h-[28px] min-w-[28px] shrink-0 items-center justify-center text-sm text-[#D6D3CD] hover:text-white"
          >
            ×
          </button>
        </div>
      )}

      {/* Product Detail Modal */}
      {activeModalProduct && activeModal && (
        <ProductDetailModal
          key={activeModal.initialMode}
          product={activeModalProduct}
          relatedProducts={relatedModalProducts}
          previewsById={previewsById}
          initialMode={activeModal.initialMode}
          isSaved={wishlistIds.includes(activeModalProduct.id)}
          onSelectSize={handleSelectSize}
          onAddToBag={handleAddToBag}
          onToggleWishlist={handleToggleWishlist}
          onSelectRelated={(nextId) =>
            setActiveModal({ productId: nextId, initialMode: activeModal.initialMode })
          }
          onPreviewsBuilt={handlePreviewsBuilt}
          onClose={() => setActiveModal(null)}
        />
      )}

      {/* Seller Listing Modal (Persists directly to SQLite) */}
      {studioState.open && (
        <SellerStudioModal
          editingProduct={studioState.editingProduct}
          mode="storefront"
          onPublish={handlePublishProduct}
          onClose={() => setStudioState({ open: false, editingProduct: null })}
        />
      )}

      {/* Wishlist Slide-Over Drawer */}
      <WishlistDrawer
        open={wishlistOpen}
        products={savedProducts}
        previewsById={previewsById}
        onInspect3D={(productId) =>
          setActiveModal({ productId, initialMode: "3d" })
        }
        onAddToBag={handleAddToBag}
        onRemove={handleToggleWishlist}
        onClose={() => setWishlistOpen(false)}
      />

      {/* Shopping Bag & Checkout Slide-Over Drawer */}
      <BagDrawer
        open={bagOpen}
        items={bagItems}
        freeShippingThreshold={settings.freeShippingThreshold}
        standardShippingFee={settings.standardShippingFee}
        onUpdateQty={(key, delta) => {
          setBagItems((prev) =>
            prev
              .map((item) =>
                item.key === key
                  ? { ...item, quantity: item.quantity + delta }
                  : item
              )
              .filter((item) => item.quantity > 0)
          );
        }}
        onRemoveItem={(key) =>
          setBagItems((prev) => prev.filter((item) => item.key !== key))
        }
        onSubmitOrder={handleSubmitOrder}
        onTrackOrder={(orderId) =>
          setTrackOrderState({ open: true, orderId })
        }
        onClear={() => setBagItems([])}
        onClose={() => setBagOpen(false)}
      />

      {/* Live Order Tracking Modal */}
      <TrackOrderModal
        key={trackOrderState.orderId || "track-empty"}
        open={trackOrderState.open}
        initialOrderId={trackOrderState.orderId}
        supportEmail={settings.supportEmail}
        onClose={() => setTrackOrderState({ open: false, orderId: "" })}
      />
    </div>
  );
}
