"use client";

import Image from "next/image";
import { CUT_LABELS, formatIDR } from "@/data/catalogProducts";
import { buildGarmentTextures } from "@/lib/garmentTextureBuilder";
import type { CatalogProduct, ProductPreviews } from "@/types/catalog";

interface ProductCardProps {
  product: CatalogProduct;
  preview?: ProductPreviews;
  isSaved: boolean;
  wasAdded: boolean;
  onSelectSize: (productId: string, size: string) => void;
  onOpenDetail: (productId: string, mode: "2d" | "3d") => void;
  onToggleWishlist: (productId: string) => void;
  onQuickAdd: (product: CatalogProduct) => void;
}

function formatBadgeLabel(badge: CatalogProduct["badge"], isUserPublished?: boolean) {
  if (badge === "NEW") return "New";
  if (badge === "BEST SELLER") return "Best Seller";
  if (badge === "LIMITED") return "Limited";
  if (isUserPublished) return "New Listing";
  return null;
}

export default function ProductCard({
  product,
  preview,
  isSaved,
  wasAdded,
  onSelectSize,
  onOpenDetail,
  onToggleWishlist,
  onQuickAdd,
}: ProductCardProps) {
  const swatchColor = preview?.extractedHex ?? product.mapping.baseColorHex;
  const badgeText = formatBadgeLabel(product.badge, product.isUserPublished);
  const displaySrc = product.mapping.frontImageUrl || preview?.front2d || "";

  const badgeTone =
    product.badge === "LIMITED"
      ? "bg-[#881337] text-white"
      : "bg-[#181817] text-white";

  return (
    <article className="group flex flex-col border border-[#E5E3DC] bg-white transition-colors duration-200 hover:border-[#181817]">
      {/* Studio Garment Photo */}
      <div className="relative aspect-square w-full overflow-hidden bg-[#EFEFEB]">
        <button
          type="button"
          onClick={() => onOpenDetail(product.id, "2d")}
          aria-label={`View ${product.title}`}
          className="block h-full w-full"
        >
          {displaySrc ? (
            <Image
              src={displaySrc}
              alt={product.title}
              width={480}
              height={480}
              unoptimized
              className="h-full w-full object-contain transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-xs text-[#57534E]">
              Preparing photo...
            </div>
          )}
        </button>

        {badgeText && (
          <span
            className={`pointer-events-none absolute left-3 top-3 px-2.5 py-1 text-[11px] font-medium tracking-wide ${badgeTone}`}
          >
            {badgeText}
          </span>
        )}

        <button
          type="button"
          onClick={() => onToggleWishlist(product.id)}
          aria-label={
            isSaved
              ? `Remove ${product.title} from saved items`
              : `Save ${product.title} to wishlist`
          }
          aria-pressed={isSaved}
          className="absolute right-2.5 top-2.5 flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] bg-white/95 text-[#181817] transition-colors hover:border-[#181817]"
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

      {/* Swatch + View Mode Strip */}
      <div className="flex items-center justify-between gap-2 border-y border-[#E5E3DC] bg-[#FAFAFA] px-3.5 py-2">
        <span className="flex min-w-0 items-center gap-2 text-[11px] font-medium capitalize text-[#181817]">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/25"
            style={{ backgroundColor: swatchColor }}
            aria-hidden="true"
          />
          <span className="truncate">{product.colorTag.toLowerCase()}</span>
        </span>
        <span className="shrink-0 text-[11px] font-medium text-[#57534E]">
          2D · 3D
        </span>
      </div>

      {/* Product Info, Quick Size & Actions */}
      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[#57534E]">
              {product.brand}
            </p>
            {product.stockStatus === "Limited Stock" && (
              <span className="text-[11px] font-medium text-[#881337]">
                Limited Stock
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => onOpenDetail(product.id, "2d")}
            className="mt-1 block text-left text-[15px] font-semibold leading-snug text-[#181817] hover:underline"
          >
            {product.title}
          </button>
          <p className="mt-0.5 text-xs text-[#57534E]">
            {CUT_LABELS[product.cut]}
          </p>

          <div className="mt-2.5 flex items-baseline gap-2 tabular-nums">
            <span className="text-sm font-semibold text-[#181817]">
              {formatIDR(product.price)}
            </span>
            {product.compareAtPrice && product.compareAtPrice > product.price && (
              <span className="text-xs text-[#57534E] line-through">
                {formatIDR(product.compareAtPrice)}
              </span>
            )}
          </div>
        </div>

        <div className="mt-3.5 space-y-2.5">
          {/* Quick Size Selector */}
          <div
            role="group"
            aria-label={`Select size for ${product.title}`}
            className="flex flex-wrap gap-1.5"
          >
            {product.sizes.map((size) => {
              const selected = product.selectedSize === size;
              return (
                <button
                  key={size}
                  type="button"
                  onClick={() => onSelectSize(product.id, size)}
                  aria-pressed={selected}
                  className={`min-h-[34px] min-w-[36px] border px-2 text-[11px] font-medium tabular-nums transition-colors ${
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

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onQuickAdd(product)}
              aria-label={`Add ${product.title} size ${product.selectedSize} to bag`}
              className="flex min-h-[44px] flex-1 items-center justify-center gap-2 bg-[#181817] px-3 text-xs font-medium tracking-wide text-white transition-colors hover:bg-[#333330]"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                aria-hidden="true"
              >
                <path d="M6 8h12l1 12H5L6 8Z" strokeLinejoin="round" />
                <path d="M9 8V6a3 3 0 0 1 6 0v2" />
              </svg>
              <span>
                {wasAdded
                  ? `Added (${product.selectedSize})`
                  : `Add · ${product.selectedSize}`}
              </span>
            </button>

            <button
              type="button"
              onPointerEnter={() => {
                void buildGarmentTextures(product).catch(() => {});
              }}
              onFocus={() => {
                void buildGarmentTextures(product).catch(() => {});
              }}
              onClick={() => onOpenDetail(product.id, "3d")}
              aria-label={`View ${product.title} in 3D`}
              className="min-h-[44px] min-w-[54px] border border-[#181817] bg-white px-2.5 text-xs font-semibold text-[#181817] transition-colors hover:bg-[#F5F5F5]"
            >
              3D
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
