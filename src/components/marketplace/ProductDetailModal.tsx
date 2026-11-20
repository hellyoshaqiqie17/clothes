"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useState } from "react";
import { CUT_LABELS, formatIDR } from "@/data/catalogProducts";
import { buildGarmentTextures } from "@/lib/garmentTextureBuilder";
import type { CatalogProduct, ProductPreviews } from "@/types/catalog";

const GarmentViewer3D = dynamic(
  () => import("@/components/marketplace/GarmentViewer3D"),
  {
    ssr: false,
    loading: () => null,
  }
);

interface ProductDetailModalProps {
  product: CatalogProduct;
  relatedProducts: CatalogProduct[];
  previewsById: Record<string, ProductPreviews>;
  initialMode: "2d" | "3d";
  isSaved: boolean;
  onSelectSize: (productId: string, size: string) => void;
  onAddToBag: (product: CatalogProduct) => void;
  onToggleWishlist: (productId: string) => void;
  onSelectRelated: (productId: string) => void;
  onPreviewsBuilt: (productId: string, previews: ProductPreviews) => void;
  onClose: () => void;
}

function formatBadge(badge: CatalogProduct["badge"], isUserPublished?: boolean) {
  if (badge === "NEW") return "New";
  if (badge === "BEST SELLER") return "Best Seller";
  if (badge === "LIMITED") return "Limited";
  if (isUserPublished) return "New Listing";
  return null;
}

export default function ProductDetailModal({
  product,
  relatedProducts,
  previewsById,
  initialMode,
  isSaved,
  onSelectSize,
  onAddToBag,
  onToggleWishlist,
  onSelectRelated,
  onPreviewsBuilt,
  onClose,
}: ProductDetailModalProps) {
  const [viewMode, setViewMode] = useState<"2d" | "3d">(initialMode);
  const [hasOpened3D, setHasOpened3D] = useState(initialMode === "3d");
  const [photoSide, setPhotoSide] = useState<"front" | "back">("front");
  const [photoZoomed, setPhotoZoomed] = useState(false);
  const [showSizeGuide, setShowSizeGuide] = useState(false);
  const [addedFeedback, setAddedFeedback] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const previews = previewsById[product.id];
  const needsAutoBack =
    !product.mapping.backImageUrl && !previews?.back2d;

  useEffect(() => {
    if (!needsAutoBack) return;
    let cancelled = false;
    void buildGarmentTextures(product)
      .then((built) => {
        if (cancelled) return;
        onPreviewsBuilt(product.id, {
          front2d: built.front2dDataUrl,
          back2d: built.back2dDataUrl,
          extractedHex: built.extractedHex,
          mappingSummary: built.mappingSummary,
        });
      })
      .catch(() => {
        // silent fallback if offline
      });
    return () => {
      cancelled = true;
    };
  }, [needsAutoBack, product, onPreviewsBuilt]);
  const front2dSrc = product.mapping.frontImageUrl || previews?.front2d || "";
  const back2dSrc = product.mapping.backImageUrl || previews?.back2d || "";
  const active2dSrc = photoSide === "front" ? front2dSrc : back2dSrc;
  const hasCustomBack = Boolean(product.mapping.backImageUrl);
  const swatchHex = previews?.extractedHex ?? product.mapping.baseColorHex;
  const badgeText = formatBadge(product.badge, product.isUserPublished);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-0 sm:p-4 lg:p-6"
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-detail-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white text-[#181817] shadow-2xl sm:h-[92dvh] sm:max-h-[840px] lg:flex-row">
        {/* Left Stage: Photos or Pure White 3D Garment View */}
        <div className="flex h-[54dvh] min-h-[340px] flex-col bg-white sm:h-[58dvh] lg:h-full lg:w-[60%]">
          <div className="flex shrink-0 items-center justify-between border-b border-[#E5E3DC] bg-white px-4 py-2.5">
            <div
              role="tablist"
              aria-label="Product display mode"
              className="inline-flex border border-[#181817] bg-[#F5F5F4] p-0.5"
            >
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "2d"}
                onClick={() => setViewMode("2d")}
                className={`min-h-[40px] px-4 text-xs font-medium transition-colors ${
                  viewMode === "2d"
                    ? "bg-[#181817] text-white"
                    : "text-[#57534E] hover:text-[#181817]"
                }`}
              >
                Photos
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === "3d"}
                onClick={() => {
                  setHasOpened3D(true);
                  setViewMode("3d");
                }}
                className={`min-h-[40px] px-4 text-xs font-medium transition-colors ${
                  viewMode === "3d"
                    ? "bg-[#181817] text-white"
                    : "text-[#57534E] hover:text-[#181817]"
                }`}
              >
                3D View
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close product dialog"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] bg-white text-base font-medium text-[#181817] hover:bg-[#F5F5F5] lg:hidden"
            >
              ×
            </button>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
            {viewMode === "2d" && (
              <div className="relative z-10 flex min-h-0 flex-1 flex-col bg-[#EFEFEB]">
                <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 sm:p-6">
                  {active2dSrc ? (
                    <div
                      className={`relative h-full w-full max-h-[500px] max-w-[500px] transition-transform duration-200 ${
                        photoZoomed ? "scale-150 cursor-zoom-out" : "scale-100 cursor-zoom-in"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setPhotoZoomed((z) => !z)}
                        aria-label={
                          photoZoomed ? "Reset photo zoom" : "Zoom into garment photo"
                        }
                        className="h-full w-full"
                      >
                        <Image
                          src={active2dSrc}
                          alt={`${product.title} ${photoSide} view`}
                          width={560}
                          height={560}
                          unoptimized
                          className="h-full w-full object-contain"
                        />
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-[#57534E]">Preparing photo...</p>
                  )}
                </div>

                <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#E5E3DC] bg-white px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {(
                      [
                        { id: "front", label: "Front", src: front2dSrc },
                        {
                          id: "back",
                          label: hasCustomBack ? "Back Design" : "Back",
                          src: back2dSrc,
                        },
                      ] as const
                    ).map((item) => {
                      const active = photoSide === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => {
                            setPhotoSide(item.id);
                            setPhotoZoomed(false);
                          }}
                          aria-pressed={active}
                          className={`flex min-h-[44px] items-center gap-2 border px-2.5 py-1 text-left transition-colors ${
                            active
                              ? "border-[#181817] bg-[#181817] text-white"
                              : "border-[#E5E3DC] bg-white text-[#181817] hover:bg-[#F5F5F5]"
                          }`}
                        >
                          {item.src && (
                            <Image
                              src={item.src}
                              alt=""
                              width={32}
                              height={32}
                              unoptimized
                              className="h-8 w-8 bg-[#EFEFEB] object-contain"
                            />
                          )}
                          <span className="text-xs font-medium">{item.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    onClick={() => setPhotoZoomed((z) => !z)}
                    aria-pressed={photoZoomed}
                    className="min-h-[44px] border border-[#E5E3DC] bg-white px-3 text-xs font-medium text-[#181817] hover:bg-[#F5F5F5]"
                  >
                    {photoZoomed ? "Reset Zoom" : "Zoom In"}
                  </button>
                </div>
              </div>
            )}

            {hasOpened3D && (
              <div
                aria-hidden={viewMode !== "3d"}
                className={
                  viewMode === "3d"
                    ? "relative min-h-0 flex-1 bg-white"
                    : "pointer-events-none invisible absolute inset-0"
                }
              >
                <GarmentViewer3D
                  product={product}
                  anglePreset="three-quarter"
                  paused={viewMode !== "3d"}
                  onPreviewsBuilt={onPreviewsBuilt}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Product Details Column */}
        <div className="flex flex-1 flex-col overflow-y-auto overscroll-contain border-t border-[#E5E3DC] bg-white lg:border-l lg:border-t-0">
          <div className="hidden items-center justify-between border-b border-[#E5E3DC] px-6 py-3.5 lg:flex">
            <span className="text-xs font-medium text-[#57534E]">
              {CUT_LABELS[product.cut]}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleWishlist(product.id)}
                aria-label={
                  isSaved
                    ? `Remove ${product.title} from saved items`
                    : `Save ${product.title} to wishlist`
                }
                aria-pressed={isSaved}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] bg-white text-[#181817] transition-colors hover:border-[#181817]"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill={isSaved ? "#881337" : "none"}
                  stroke={isSaved ? "#881337" : "currentColor"}
                  strokeWidth="1.75"
                  aria-hidden="true"
                >
                  <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                </svg>
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close product dialog"
                className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] text-base font-medium text-[#181817] hover:bg-[#F5F5F5]"
              >
                ×
              </button>
            </div>
          </div>

          <div className="flex flex-1 flex-col justify-between p-5 sm:p-6">
            <div className="space-y-5">
              <div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#57534E]">
                      {product.brand}
                    </span>
                    {badgeText && (
                      <span
                        className={`px-2 py-0.5 text-[11px] font-medium ${
                          product.badge === "LIMITED"
                            ? "bg-[#881337] text-white"
                            : "bg-[#181817] text-white"
                        }`}
                      >
                        {badgeText}
                      </span>
                    )}
                  </div>
                  <span className="text-xs font-medium text-[#57534E]">
                    {product.stockStatus}
                  </span>
                </div>

                <h2
                  id="product-detail-title"
                  className="mt-2 font-display text-2xl font-normal leading-tight tracking-[-0.015em] text-[#181817] sm:text-[28px]"
                >
                  {product.title}
                </h2>

                <div className="mt-2 flex items-baseline gap-2.5 tabular-nums">
                  <span className="text-lg font-semibold text-[#181817]">
                    {formatIDR(product.price)}
                  </span>
                  {product.compareAtPrice && product.compareAtPrice > product.price && (
                    <span className="text-sm text-[#57534E] line-through">
                      {formatIDR(product.compareAtPrice)}
                    </span>
                  )}
                </div>
              </div>

              <p className="text-sm leading-relaxed text-[#57534E]">
                {product.description}
              </p>

              {/* Garment Details */}
              <div className="space-y-2 border border-[#E5E3DC] bg-[#FAFAFA] p-3.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-[#57534E]">Fit &amp; Cut</span>
                  <span className="font-medium text-[#181817]">
                    {CUT_LABELS[product.cut]}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#57534E]">Color</span>
                  <span className="inline-flex items-center gap-1.5 font-medium capitalize text-[#181817]">
                    <span
                      className="h-3 w-3 rounded-full border border-black/25"
                      style={{ backgroundColor: swatchHex }}
                      aria-hidden="true"
                    />
                    {product.colorTag.toLowerCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[#57534E]">3D Preview</span>
                  <span className="text-right font-medium text-[#881337]">
                    {hasCustomBack
                      ? "Front & back design"
                      : product.mapping.frontImageUrl
                      ? "Auto-matched back"
                      : "360° interactive"}
                  </span>
                </div>
              </div>

              {/* Size Picker + Expandable Size Guide */}
              <div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-[#181817]">
                    Select Size
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowSizeGuide((v) => !v)}
                    aria-expanded={showSizeGuide}
                    className="min-h-[32px] text-xs font-medium text-[#57534E] underline underline-offset-4 hover:text-[#181817]"
                  >
                    {showSizeGuide ? "Hide Size Guide" : "Size Guide (cm)"}
                  </button>
                </div>
                <div
                  role="group"
                  aria-label="Available sizes"
                  className="mt-2 flex flex-wrap gap-2"
                >
                  {product.sizes.map((size) => {
                    const selected = product.selectedSize === size;
                    return (
                      <button
                        key={size}
                        type="button"
                        onClick={() => onSelectSize(product.id, size)}
                        aria-pressed={selected}
                        className={`min-h-[44px] min-w-[48px] border px-3 text-xs font-medium tabular-nums transition-colors ${
                          selected
                            ? "border-[#181817] bg-[#181817] text-white"
                            : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                        }`}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>

                {showSizeGuide && (
                  <div className="mt-3 overflow-x-auto border border-[#E5E3DC] bg-[#FAFAFA] p-3 text-[11px]">
                    <p className="mb-2 font-semibold text-[#181817]">
                      {product.category === "top"
                        ? "Garment Measurements (Tops, cm)"
                        : product.cut === "shorts"
                        ? "Garment Measurements (Shorts, cm)"
                        : "Garment Measurements (Trousers, cm)"}
                    </p>
                    <table className="w-full border-collapse text-left tabular-nums">
                      <thead>
                        <tr className="border-b border-[#E5E3DC] text-[#57534E]">
                          <th className="py-1 pr-3 font-medium">Size</th>
                          {product.category === "top" ? (
                            <>
                              <th className="py-1 pr-3 font-medium">Chest</th>
                              <th className="py-1 pr-3 font-medium">Length</th>
                              <th className="py-1 font-medium">Shoulder</th>
                            </>
                          ) : (
                            <>
                              <th className="py-1 pr-3 font-medium">Waist</th>
                              <th className="py-1 pr-3 font-medium">Length</th>
                              <th className="py-1 font-medium">Hem</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#E5E3DC] text-[#181817]">
                        {product.sizes.map((sz, idx) => {
                          const step = idx;
                          if (product.category === "top") {
                            const baseChest =
                              product.cut === "jacket" || product.cut === "hoodie"
                                ? 58
                                : 54;
                            const baseLen = product.cut === "tee" ? 68 : 66;
                            const baseSh = 49;
                            return (
                              <tr key={sz}>
                                <td className="py-1 pr-3 font-semibold">{sz}</td>
                                <td className="py-1 pr-3">{baseChest + step * 3}</td>
                                <td className="py-1 pr-3">{baseLen + step * 2}</td>
                                <td className="py-1">{baseSh + step * 2}</td>
                              </tr>
                            );
                          }
                          const baseWaist = 74;
                          const baseOutseam = product.cut === "shorts" ? 49 : 102;
                          const baseHem =
                            product.cut === "baggy-denim" || product.cut === "cargo"
                              ? 24
                              : product.cut === "shorts"
                              ? 30
                              : 20;
                          return (
                            <tr key={sz}>
                              <td className="py-1 pr-3 font-semibold">{sz}</td>
                              <td className="py-1 pr-3">{baseWaist + step * 5}</td>
                              <td className="py-1 pr-3">{baseOutseam + step * 2}</td>
                              <td className="py-1">{baseHem + step}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="space-y-2.5 pt-1">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      onAddToBag(product);
                      setAddedFeedback(true);
                      window.setTimeout(() => setAddedFeedback(false), 1400);
                    }}
                    className="min-h-[48px] flex-1 bg-[#181817] px-4 py-3 text-xs font-medium tracking-wide tabular-nums text-white transition-colors hover:bg-[#333330]"
                  >
                    {addedFeedback
                      ? `Added Size ${product.selectedSize} to Bag`
                      : `Add to Bag · ${formatIDR(product.price)}`}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleWishlist(product.id)}
                    aria-label={
                      isSaved
                        ? `Remove ${product.title} from saved items`
                        : `Save ${product.title} to wishlist`
                    }
                    aria-pressed={isSaved}
                    className="flex min-h-[48px] min-w-[48px] items-center justify-center border border-[#E5E3DC] bg-white text-[#181817] transition-colors hover:border-[#181817] lg:hidden"
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill={isSaved ? "#881337" : "none"}
                      stroke={isSaved ? "#881337" : "currentColor"}
                      strokeWidth="1.75"
                      aria-hidden="true"
                    >
                      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Related Pieces */}
            {relatedProducts.length > 0 && (
              <div className="mt-6 border-t border-[#E5E3DC] pt-4">
                <p className="text-xs font-semibold text-[#181817]">
                  You may also like
                </p>
                <div className="mt-2.5 grid grid-cols-3 gap-2">
                  {relatedProducts.slice(0, 3).map((rel) => {
                    const relImg =
                      rel.mapping.frontImageUrl || previewsById[rel.id]?.front2d;
                    return (
                      <button
                        key={rel.id}
                        type="button"
                        onClick={() => {
                          setPhotoSide("front");
                          setPhotoZoomed(false);
                          setAddedFeedback(false);
                          onSelectRelated(rel.id);
                        }}
                        className="group flex flex-col border border-[#E5E3DC] bg-white p-2 text-left transition-colors hover:border-[#181817]"
                      >
                        <div className="aspect-square w-full overflow-hidden bg-[#EFEFEB]">
                          {relImg && (
                            <Image
                              src={relImg}
                              alt={rel.title}
                              width={120}
                              height={120}
                              unoptimized
                              className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-105"
                            />
                          )}
                        </div>
                        <span className="mt-1.5 line-clamp-1 text-[11px] font-semibold text-[#181817]">
                          {rel.title}
                        </span>
                        <span className="text-[11px] tabular-nums text-[#57534E]">
                          {formatIDR(rel.price)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
