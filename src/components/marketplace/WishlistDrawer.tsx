"use client";

import Image from "next/image";
import { useEffect } from "react";
import { formatIDR } from "@/data/catalogProducts";
import type { CatalogProduct, ProductPreviews } from "@/types/catalog";

interface WishlistDrawerProps {
  open: boolean;
  products: CatalogProduct[];
  previewsById: Record<string, ProductPreviews>;
  onInspect3D: (productId: string) => void;
  onAddToBag: (product: CatalogProduct) => void;
  onRemove: (productId: string) => void;
  onClose: () => void;
}

export default function WishlistDrawer({
  open,
  products,
  previewsById,
  onInspect3D,
  onAddToBag,
  onRemove,
  onClose,
}: WishlistDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/55"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wishlist-drawer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-full w-full max-w-md flex-col bg-white text-[#181817] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#E5E3DC] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <h2
              id="wishlist-drawer-title"
              className="font-display text-xl font-medium tracking-tight text-[#181817]"
            >
              Saved Items
            </h2>
            <span className="inline-flex h-5 min-w-[20px] items-center justify-center bg-[#881337] px-1.5 text-[11px] font-semibold tabular-nums text-white">
              {products.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close saved items"
            className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] text-base font-medium text-[#181817] hover:bg-[#F5F5F5]"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
          {products.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-12 text-center">
              <p className="text-sm font-semibold text-[#181817]">No saved items yet</p>
              <p className="mt-1.5 max-w-xs text-xs leading-relaxed text-[#57534E]">
                Tap the heart icon on any piece to save it here while you compare cuts
                and sizes.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-5 min-h-[44px] bg-[#181817] px-5 text-xs font-medium text-white hover:bg-[#333330]"
              >
                Browse Store
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-[#E5E3DC]">
              {products.map((product) => {
                const thumb =
                  product.mapping.frontImageUrl || previewsById[product.id]?.front2d;
                return (
                  <li key={product.id} className="flex gap-3.5 py-4">
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
                          2D
                        </div>
                      )}
                    </div>

                    <div className="flex min-w-0 flex-1 flex-col justify-between">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium uppercase tracking-[0.1em] text-[#57534E]">
                            {product.brand}
                          </p>
                          <p className="truncate text-sm font-semibold text-[#181817]">
                            {product.title}
                          </p>
                          <p className="mt-0.5 text-xs font-semibold tabular-nums text-[#181817]">
                            {formatIDR(product.price)} · Size {product.selectedSize}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRemove(product.id)}
                          aria-label={`Remove ${product.title} from saved items`}
                          className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-sm text-[#57534E] hover:text-[#881337]"
                        >
                          ×
                        </button>
                      </div>

                      <div className="mt-2.5 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onAddToBag(product)}
                          className="min-h-[44px] flex-1 bg-[#181817] px-3 text-xs font-medium text-white hover:bg-[#333330]"
                        >
                          Add Size {product.selectedSize}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onInspect3D(product.id);
                          }}
                          className="min-h-[44px] border border-[#181817] bg-white px-3 text-xs font-semibold text-[#181817] hover:bg-[#F5F5F5]"
                        >
                          3D View
                        </button>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
