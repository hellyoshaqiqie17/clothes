"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  createDefaultMapping,
  formatIDR,
  normalizeProductTag,
} from "@/data/catalogProducts";
import { isValidGarmentImageUrl } from "@/lib/garmentTextureBuilder";
import type {
  BottomCut,
  CatalogProduct,
  CollectionTag,
  GarmentCut,
  GarmentMapping,
  ProductBadge,
  ProductCategory,
  ProductPreviews,
  ProjectionMode,
  TopCut,
  ViewerAngle,
} from "@/types/catalog";

const GarmentViewer3D = dynamic(
  () => import("@/components/marketplace/GarmentViewer3D"),
  {
    ssr: false,
    loading: () => null,
  }
);

interface SellerStudioModalProps {
  editingProduct: CatalogProduct | null;
  mode?: "storefront" | "admin";
  onPublish: (product: CatalogProduct, previews: ProductPreviews | null) => void;
  onClose: () => void;
}

const TOP_CUTS: { value: TopCut; label: string }[] = [
  { value: "tee", label: "Short-Sleeve Tee" },
  { value: "longsleeve", label: "Long-Sleeve" },
  { value: "knit", label: "Knit Sweater" },
  { value: "hoodie", label: "Pullover / Hoodie" },
  { value: "jacket", label: "Boxy Jacket" },
];

const BOTTOM_CUTS: { value: BottomCut; label: string }[] = [
  { value: "baggy-denim", label: "Baggy Denim" },
  { value: "cargo", label: "Parachute Cargo" },
  { value: "trouser", label: "Straight Trouser" },
  { value: "shorts", label: "Utility Shorts" },
];

const PROJECTION_MODES: { value: ProjectionMode; label: string; detail: string }[] = [
  {
    value: "auto-garment",
    label: "Garment Photo",
    detail:
      "Isolates the garment and wraps color or weave to the back if only front is uploaded.",
  },
  {
    value: "all-over-pattern",
    label: "All-Over Pattern",
    detail: "Tiles a fabric pattern seamlessly across front, back, and sleeves.",
  },
  {
    value: "chest-graphic",
    label: "Artwork Print",
    detail: "Places logo or artwork cleanly over your selected base fabric color.",
  },
];

const MAX_FILE_BYTES = 12 * 1024 * 1024;

const STUDIO_SAMPLE_PRESETS: {
  label: string;
  category: ProductCategory;
  cut: GarmentCut;
  front: string;
  back: string | null;
  hex: string;
}[] = [
  {
    label: "Box Tee (Front + Back)",
    category: "top",
    cut: "tee",
    front: "/garments/heavyweight-box-tee-front.jpg",
    back: "/garments/heavyweight-box-tee-back.jpg",
    hex: "#DDD9D0",
  },
  {
    label: "Charcoal Knit",
    category: "top",
    cut: "knit",
    front: "/garments/ribbed-knit-crewneck-front.jpg",
    back: null,
    hex: "#272A2F",
  },
  {
    label: "Washed Pullover",
    category: "top",
    cut: "hoodie",
    front: "/garments/washed-fleece-hoodie-front.jpg",
    back: "/garments/washed-fleece-hoodie-back.jpg",
    hex: "#363A40",
  },
  {
    label: "Work Jacket",
    category: "top",
    cut: "jacket",
    front: "/garments/twill-work-jacket-front.jpg",
    back: null,
    hex: "#1E2126",
  },
  {
    label: "Light-Wash Denim",
    category: "bottom",
    cut: "baggy-denim",
    front: "/garments/light-wash-baggy-denim-front.jpg",
    back: null,
    hex: "#7F93A9",
  },
  {
    label: "Parachute Cargo",
    category: "bottom",
    cut: "cargo",
    front: "/garments/tech-parachute-cargo-front.jpg",
    back: null,
    hex: "#1D2025",
  },
];

function fileToOptimizedDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read "${file.name}".`));
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        reject(new Error(`Empty image data in "${file.name}".`));
        return;
      }
      const img = new window.Image();
      img.onload = () => {
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(32, Math.round(img.width * scale));
        const h = Math.max(32, Math.round(img.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        const isPng = file.type.toLowerCase() === "image/png";
        resolve(
          isPng
            ? canvas.toDataURL("image/png")
            : canvas.toDataURL("image/jpeg", 0.86)
        );
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadGarmentImage(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" is not a valid image (PNG, JPG, WebP).`);
  }
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`"${file.name}" exceeds the 12 MB size limit.`);
  }

  // Try uploading to R2 (/api/uploads) when within serverless body size limit,
  // and seamlessly fall back to optimized client-side data URL if R2 is not configured.
  if (file.size <= 3.8 * 1024 * 1024) {
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });
      const data = (await res.json()) as { url?: string };
      if (res.ok && data.url) {
        return data.url;
      }
    } catch {
      // Fall back to client-side optimized data URL below
    }
  }

  return fileToOptimizedDataUrl(file);
}

function buildInitialDraft(editingProduct: CatalogProduct | null): CatalogProduct {
  if (editingProduct) {
    return {
      ...editingProduct,
      mapping: { ...editingProduct.mapping },
      sizes: [...editingProduct.sizes],
      tags: [...(editingProduct.tags ?? [])],
    };
  }
  return {
    id: "",
    title: "",
    brand: "MERIDIAN",
    season: "SS27",
    category: "top",
    cut: "tee",
    collection: "new-arrivals",
    badge: "NEW",
    colorTag: "OFF-WHITE COTTON",
    price: 450000,
    stockStatus: "In Stock",
    description:
      "Everyday garment listed directly on Meridian with studio photography and interactive 3D view.",
    sizes: ["S", "M", "L", "XL"],
    selectedSize: "L",
    presetKind: "custom",
    isFeatured: false,
    isUserPublished: true,
    mapping: createDefaultMapping("#D8D4CC", "UPLOAD FRONT PHOTO"),
    createdAt: 0,
  };
}

export default function SellerStudioModal({
  editingProduct,
  mode = "storefront",
  onPublish,
  onClose,
}: SellerStudioModalProps) {
  const [draft, setDraft] = useState<CatalogProduct>(() =>
    buildInitialDraft(editingProduct)
  );
  const [priceInput, setPriceInput] = useState<string>(() =>
    String(editingProduct ? editingProduct.price : 450000)
  );
  const [compareInput, setCompareInput] = useState<string>(() =>
    editingProduct?.compareAtPrice ? String(editingProduct.compareAtPrice) : ""
  );
  const [tagInput, setTagInput] = useState("");
  const [previewMode, setPreviewMode] = useState<"3d" | "2d">("3d");
  const [anglePreset, setAnglePreset] = useState<ViewerAngle>("three-quarter");
  const [livePreviews, setLivePreviews] = useState<ProductPreviews | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const multiInputRef = useRef<HTMLInputElement | null>(null);
  const frontInputRef = useRef<HTMLInputElement | null>(null);
  const backInputRef = useRef<HTMLInputElement | null>(null);
  const sleeveInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const patchMapping = (partial: Partial<GarmentMapping>) => {
    setDraft((prev) => {
      const nextMap = { ...prev.mapping, ...partial };
      const hasUpload = Boolean(
        nextMap.frontImageUrl || nextMap.backImageUrl || nextMap.sleeveImageUrl
      );
      return {
        ...prev,
        presetKind: hasUpload ? "custom" : prev.presetKind,
        mapping: nextMap,
      };
    });
  };

  const handleCategoryChange = (category: ProductCategory) => {
    setDraft((prev) => {
      if (prev.category === category) return prev;
      return {
        ...prev,
        category,
        cut: category === "top" ? "tee" : "baggy-denim",
        sizes: category === "top" ? ["S", "M", "L", "XL"] : ["28", "30", "32", "34"],
        selectedSize: category === "top" ? "L" : "32",
      };
    });
    setAnglePreset("three-quarter");
  };

  const handleMultiFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsUploading(true);
    try {
      const selected = Array.from(files).slice(0, 3);
      const urls = await Promise.all(selected.map(uploadGarmentImage));
      const cleanName = selected[0].name
        .replace(/\.[^/.]+$/, "")
        .replace(/[-_]+/g, " ")
        .trim();

      setDraft((prev) => ({
        ...prev,
        title: prev.title.trim() ? prev.title : cleanName || "New Garment",
        colorTag: urls[1] ? "FRONT & BACK PRINT" : prev.colorTag,
        presetKind: "custom",
        mapping: {
          ...prev.mapping,
          frontImageUrl: urls[0],
          backImageUrl: urls[1] ?? prev.mapping.backImageUrl,
          sleeveImageUrl: urls[2] ?? prev.mapping.sleeveImageUrl,
        },
      }));
      setAnglePreset(urls[1] ? "three-quarter" : "front");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not upload image.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSlotUpload = async (
    slot: "frontImageUrl" | "backImageUrl" | "sleeveImageUrl",
    files: FileList | null
  ) => {
    if (!files || files.length === 0) return;
    setErrorMsg(null);
    setIsUploading(true);
    try {
      const file = files[0];
      const url = await uploadGarmentImage(file);
      const cleanName = file.name
        .replace(/\.[^/.]+$/, "")
        .replace(/[-_]+/g, " ")
        .trim();

      setDraft((prev) => {
        const nextMap = { ...prev.mapping, [slot]: url };
        return {
          ...prev,
          title:
            slot === "frontImageUrl" && !prev.title.trim()
              ? cleanName || "New Garment"
              : prev.title,
          presetKind: "custom",
          mapping: nextMap,
        };
      });

      if (slot === "backImageUrl") setAnglePreset("back");
      else if (slot === "frontImageUrl") setAnglePreset("front");
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Could not upload image.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedTitle = draft.title.trim();
    if (!trimmedTitle) {
      setErrorMsg("Enter a product name before saving.");
      return;
    }
    const parsedPrice = Number.parseFloat(priceInput);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 10000) {
      setErrorMsg("Enter a valid price in IDR (minimum Rp 10.000).");
      return;
    }
    const parsedCompare = compareInput.trim()
      ? Number.parseFloat(compareInput)
      : undefined;

    setErrorMsg(null);
    setIsSaving(true);

    const payload: Record<string, unknown> = {
      ...draft,
      title: trimmedTitle,
      brand: draft.brand.trim().toUpperCase() || "MERIDIAN",
      price: Math.round(parsedPrice),
      compareAtPrice:
        parsedCompare && Number.isFinite(parsedCompare) && parsedCompare > parsedPrice
          ? Math.round(parsedCompare)
          : null,
      badge: draft.badge ?? null,
      colorTag: draft.colorTag.trim().toUpperCase() || "CUSTOM FABRIC",
      mapping: {
        ...draft.mapping,
        frontImageUrl: isValidGarmentImageUrl(draft.mapping.frontImageUrl)
          ? draft.mapping.frontImageUrl.trim()
          : null,
        backImageUrl: isValidGarmentImageUrl(draft.mapping.backImageUrl)
          ? draft.mapping.backImageUrl.trim()
          : null,
        sleeveImageUrl: isValidGarmentImageUrl(draft.mapping.sleeveImageUrl)
          ? draft.mapping.sleeveImageUrl.trim()
          : null,
        baseColorHex: livePreviews?.extractedHex ?? draft.mapping.baseColorHex,
        detectedFabricLabel:
          livePreviews?.mappingSummary ?? draft.mapping.detectedFabricLabel,
      },
      isUserPublished: editingProduct
        ? editingProduct.isUserPublished
        : mode === "storefront",
    };

    try {
      const isEdit = Boolean(editingProduct?.id);
      const res = await fetch(
        isEdit ? `/api/products/${encodeURIComponent(editingProduct!.id)}` : "/api/products",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = (await res.json()) as { product?: CatalogProduct; error?: string };
      if (!res.ok || !data.product) {
        throw new Error(data.error || "Failed to save product to database.");
      }

      const finalPreviews: ProductPreviews | null = livePreviews
        ? {
            ...livePreviews,
            front2d: data.product.mapping.frontImageUrl || livePreviews.front2d,
            back2d: data.product.mapping.backImageUrl || livePreviews.back2d,
          }
        : null;

      onPublish(data.product, finalPreviews);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Failed to save product to database."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const cuts = draft.category === "top" ? TOP_CUTS : BOTTOM_CUTS;
  const parsedPreviewPrice = Number.parseFloat(priceInput);
  const validFrontUrl = isValidGarmentImageUrl(draft.mapping.frontImageUrl)
    ? draft.mapping.frontImageUrl.trim()
    : null;
  const validBackUrl = isValidGarmentImageUrl(draft.mapping.backImageUrl)
    ? draft.mapping.backImageUrl.trim()
    : null;
  const validSleeveUrl = isValidGarmentImageUrl(draft.mapping.sleeveImageUrl)
    ? draft.mapping.sleeveImageUrl.trim()
    : null;
  const frontFlatPreview = validFrontUrl || livePreviews?.front2d;
  const backFlatPreview = validBackUrl || livePreviews?.back2d;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="seller-studio-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-white text-[#181817] shadow-2xl sm:h-[92dvh] sm:max-h-[860px] lg:flex-row">
        {/* Left: Pure White 3D Preview + Photo Flats */}
        <div className="flex h-[42dvh] min-h-[280px] flex-col border-b border-[#E5E3DC] bg-white lg:h-full lg:w-[52%] lg:border-b-0 lg:border-r">
          <div className="flex shrink-0 items-center justify-between border-b border-[#E5E3DC] bg-white px-4 py-2.5 text-[#181817]">
            <div className="inline-flex border border-[#181817] bg-[#F5F5F4] p-0.5">
              <button
                type="button"
                onClick={() => setPreviewMode("3d")}
                aria-pressed={previewMode === "3d"}
                className={`min-h-[38px] px-3.5 text-xs font-medium transition-colors ${
                  previewMode === "3d"
                    ? "bg-[#181817] text-white"
                    : "text-[#57534E] hover:text-[#181817]"
                }`}
              >
                3D Preview
              </button>
              <button
                type="button"
                onClick={() => setPreviewMode("2d")}
                aria-pressed={previewMode === "2d"}
                className={`min-h-[38px] px-3.5 text-xs font-medium transition-colors ${
                  previewMode === "2d"
                    ? "bg-[#181817] text-white"
                    : "text-[#57534E] hover:text-[#181817]"
                }`}
              >
                2D Photos
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close product editor"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] bg-white text-base font-medium text-[#181817] hover:bg-[#F5F5F5] lg:hidden"
            >
              ×
            </button>
          </div>

          {previewMode === "3d" ? (
            <div className="relative min-h-0 flex-1 bg-white">
              <GarmentViewer3D
                product={{ ...draft, id: draft.id || "draft-preview" }}
                anglePreset={anglePreset}
                onPreviewsBuilt={(_id, previews) => setLivePreviews(previews)}
              />
            </div>
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-4 overflow-y-auto bg-[#EFEFEB] p-5">
              <div className="flex flex-col border border-[#E5E3DC] bg-white p-3">
                <span className="text-xs font-semibold text-[#181817]">
                  Front Photo
                </span>
                <div className="mt-2 flex flex-1 items-center justify-center bg-[#EFEFEB] p-2">
                  {frontFlatPreview ? (
                    <Image
                      src={frontFlatPreview}
                      alt="Front 2D preview"
                      width={360}
                      height={360}
                      unoptimized
                      className="max-h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-[#57534E]">No front photo yet</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col border border-[#E5E3DC] bg-white p-3">
                <span className="text-xs font-semibold text-[#181817]">
                  {draft.mapping.backImageUrl ? "Back Design" : "Back (Matched)"}
                </span>
                <div className="mt-2 flex flex-1 items-center justify-center bg-[#EFEFEB] p-2">
                  {backFlatPreview ? (
                    <Image
                      src={backFlatPreview}
                      alt="Back 2D preview"
                      width={360}
                      height={360}
                      unoptimized
                      className="max-h-full w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-[#57534E]">Generating...</span>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: Upload Photos + Full Database Listing Form */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col bg-white lg:w-[48%]"
        >
          <div className="hidden items-center justify-between border-b border-[#E5E3DC] px-5 py-3.5 lg:flex">
            <div>
              <h2
                id="seller-studio-title"
                className="font-display text-xl font-normal tracking-tight text-[#181817]"
              >
                {editingProduct
                  ? `Edit "${editingProduct.title}"`
                  : mode === "admin"
                  ? "Create New Product"
                  : "List a New Piece"}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close product editor"
              className="flex min-h-[44px] min-w-[44px] items-center justify-center border border-[#E5E3DC] text-base font-medium hover:bg-[#F5F5F5]"
            >
              ×
            </button>
          </div>

          <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
            {errorMsg && (
              <div
                role="alert"
                className="border border-[#881337] bg-[#FFF1F2] p-3 text-xs text-[#881337]"
              >
                <p className="font-semibold">Action needed</p>
                <p className="mt-0.5">{errorMsg}</p>
              </div>
            )}

            {isUploading && (
              <div
                aria-live="polite"
                className="border border-[#E5E3DC] bg-[#FAFAFA] px-3 py-2 text-xs text-[#181817]"
              >
                Uploading garment photo and projecting onto 3D view...
              </div>
            )}

            {/* 1. Category */}
            <div>
              <span className="block text-xs font-semibold text-[#181817]">
                1. Category
              </span>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {(
                  [
                    { key: "top", label: "Tops & Shirts" },
                    { key: "bottom", label: "Bottoms & Pants" },
                  ] as const
                ).map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    onClick={() => handleCategoryChange(cat.key)}
                    aria-pressed={draft.category === cat.key}
                    className={`min-h-[44px] border px-3 text-xs font-medium transition-colors ${
                      draft.category === cat.key
                        ? "border-[#181817] bg-[#181817] text-white"
                        : "border-[#E5E3DC] bg-white text-[#181817] hover:bg-[#F5F5F5]"
                    }`}
                  >
                    {cat.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 2. Silhouette */}
            <div>
              <span className="block text-xs font-semibold text-[#181817]">
                2. Cut &amp; 3D Silhouette
              </span>
              <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {cuts.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({ ...prev, cut: c.value as GarmentCut }))
                    }
                    aria-pressed={draft.cut === c.value}
                    className={`min-h-[44px] border px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                      draft.cut === c.value
                        ? "border-[#181817] bg-[#181817] text-white"
                        : "border-[#E5E3DC] bg-white text-[#181817] hover:bg-[#F5F5F5]"
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 3. Photos */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#181817]">
                  3. Garment Photos
                </span>
                {(draft.mapping.frontImageUrl || draft.mapping.backImageUrl) && (
                  <button
                    type="button"
                    onClick={() =>
                      patchMapping({
                        frontImageUrl: draft.mapping.backImageUrl,
                        backImageUrl: draft.mapping.frontImageUrl,
                      })
                    }
                    className="min-h-[36px] border border-[#E5E3DC] px-2.5 text-[11px] font-medium text-[#181817] hover:bg-[#F5F5F5]"
                  >
                    Swap Front / Back
                  </button>
                )}
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  void handleMultiFiles(e.dataTransfer.files);
                }}
                className={`border border-dashed p-3.5 text-center transition-colors ${
                  isDragging
                    ? "border-[#181817] bg-[#F5F5F4]"
                    : "border-[#A8A29E] bg-[#FAFAFA]"
                }`}
              >
                <input
                  ref={multiInputRef}
                  id="seller-multi-upload"
                  type="file"
                  accept="image/*"
                  multiple
                  className="sr-only"
                  onChange={(e) => {
                    void handleMultiFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <p className="text-xs font-semibold text-[#181817]">
                  Drop 1 front photo, or upload front + back photos together
                </p>
                <p className="mt-1 text-[11px] text-[#57534E]">
                  Front-only photos automatically match fabric tone on the 3D back.
                </p>
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => multiInputRef.current?.click()}
                  className="mt-2.5 inline-flex min-h-[44px] items-center bg-[#181817] px-4 text-xs font-medium text-white hover:bg-[#333330] disabled:opacity-60"
                >
                  {isUploading ? "Uploading..." : "Choose Photos"}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="flex flex-col border border-[#E5E3DC] bg-white p-2">
                  <span className="text-[11px] font-semibold text-[#181817]">
                    Front
                  </span>
                  <input
                    ref={frontInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    aria-label="Upload front garment photo"
                    onChange={(e) => {
                      void handleSlotUpload("frontImageUrl", e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="mt-1.5 flex h-16 items-center justify-center overflow-hidden bg-[#EFEFEB]">
                    {validFrontUrl ? (
                      <Image
                        src={validFrontUrl}
                        alt="Front photo"
                        width={80}
                        height={64}
                        unoptimized
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-[#57534E]">Primary</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <button
                      type="button"
                      onClick={() => frontInputRef.current?.click()}
                      className="min-h-[36px] flex-1 bg-[#181817] px-1.5 text-[11px] font-medium text-white"
                    >
                      {validFrontUrl ? "Change" : "Upload"}
                    </button>
                    {validFrontUrl && (
                      <button
                        type="button"
                        aria-label="Clear front upload"
                        onClick={() => patchMapping({ frontImageUrl: null })}
                        className="min-h-[36px] border border-[#E5E3DC] px-2 text-xs"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col border border-[#E5E3DC] bg-white p-2">
                  <span className="text-[11px] font-semibold text-[#181817]">
                    Back
                  </span>
                  <input
                    ref={backInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    aria-label="Upload back garment photo"
                    onChange={(e) => {
                      void handleSlotUpload("backImageUrl", e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="mt-1.5 flex h-16 items-center justify-center overflow-hidden bg-[#EFEFEB]">
                    {validBackUrl ? (
                      <Image
                        src={validBackUrl}
                        alt="Back photo"
                        width={80}
                        height={64}
                        unoptimized
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1 text-center">
                        <span
                          className="h-3.5 w-3.5 rounded-full border border-black/25"
                          style={{
                            backgroundColor:
                              livePreviews?.extractedHex ?? draft.mapping.baseColorHex,
                          }}
                          aria-hidden="true"
                        />
                        <span className="text-[10px] text-[#57534E]">Auto-match</span>
                      </div>
                    )}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <button
                      type="button"
                      onClick={() => backInputRef.current?.click()}
                      className="min-h-[36px] flex-1 border border-[#181817] bg-white px-1.5 text-[11px] font-medium text-[#181817]"
                    >
                      {validBackUrl ? "Change" : "Add Back"}
                    </button>
                    {validBackUrl && (
                      <button
                        type="button"
                        aria-label="Remove back design"
                        onClick={() => patchMapping({ backImageUrl: null })}
                        className="min-h-[36px] border border-[#E5E3DC] px-2 text-xs"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-col border border-[#E5E3DC] bg-white p-2">
                  <span className="text-[11px] font-semibold text-[#181817]">
                    Sleeve
                  </span>
                  <input
                    ref={sleeveInputRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    aria-label="Upload sleeve detail photo"
                    onChange={(e) => {
                      void handleSlotUpload("sleeveImageUrl", e.target.files);
                      e.target.value = "";
                    }}
                  />
                  <div className="mt-1.5 flex h-16 items-center justify-center overflow-hidden bg-[#EFEFEB]">
                    {validSleeveUrl ? (
                      <Image
                        src={validSleeveUrl}
                        alt="Sleeve detail"
                        width={80}
                        height={64}
                        unoptimized
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <span className="text-[10px] text-[#57534E]">Optional</span>
                    )}
                  </div>
                  <div className="mt-1.5 flex gap-1">
                    <button
                      type="button"
                      onClick={() => sleeveInputRef.current?.click()}
                      className="min-h-[36px] flex-1 border border-[#E5E3DC] bg-white px-1.5 text-[11px] font-medium text-[#181817]"
                    >
                      {validSleeveUrl ? "Change" : "Add"}
                    </button>
                    {validSleeveUrl && (
                      <button
                        type="button"
                        aria-label="Remove sleeve image"
                        onClick={() => patchMapping({ sleeveImageUrl: null })}
                        className="min-h-[36px] border border-[#E5E3DC] px-2 text-xs"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* 1-Click Quick Studio Sample Presets */}
              <div className="border border-[#E5E3DC] bg-[#FAFAFA] p-2.5">
                <span className="block text-[11px] font-semibold text-[#181817]">
                  Quick Studio Sample Packshots (1-Click Apply)
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {STUDIO_SAMPLE_PRESETS.map((sample) => {
                    const isSelected = validFrontUrl === sample.front;
                    return (
                      <button
                        key={sample.label}
                        type="button"
                        onClick={() => {
                          setDraft((prev) => ({
                            ...prev,
                            category: sample.category,
                            cut: sample.cut,
                            presetKind: "custom",
                            mapping: {
                              ...prev.mapping,
                              frontImageUrl: sample.front,
                              backImageUrl: sample.back,
                              baseColorHex: sample.hex,
                            },
                          }));
                          setAnglePreset("three-quarter");
                        }}
                        className={`min-h-[32px] border px-2.5 text-[11px] font-medium transition-colors ${
                          isSelected
                            ? "border-[#181817] bg-[#181817] text-white"
                            : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                        }`}
                      >
                        {sample.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 4. Print & Fabric Fit */}
            <div className="space-y-3 border-t border-[#E5E3DC] pt-4">
              <span className="block text-xs font-semibold text-[#181817]">
                4. 3D Mapping &amp; Fabric
              </span>
              <div className="grid grid-cols-3 gap-1.5">
                {PROJECTION_MODES.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    title={m.detail}
                    onClick={() => patchMapping({ projectionMode: m.value })}
                    aria-pressed={draft.mapping.projectionMode === m.value}
                    className={`min-h-[40px] border px-2 text-[11px] font-medium transition-colors ${
                      draft.mapping.projectionMode === m.value
                        ? "border-[#181817] bg-[#181817] text-white"
                        : "border-[#E5E3DC] bg-white text-[#181817] hover:bg-[#F5F5F5]"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <input
                    id="studio-auto-bg"
                    type="checkbox"
                    checked={draft.mapping.autoRemoveBackground}
                    onChange={(e) =>
                      patchMapping({ autoRemoveBackground: e.target.checked })
                    }
                    className="h-4 w-4 accent-[#181817]"
                  />
                  <label htmlFor="studio-auto-bg" className="text-xs text-[#181817]">
                    Auto-remove studio photo background
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <label htmlFor="studio-base-hex" className="text-xs text-[#57534E]">
                    Base Color
                  </label>
                  <input
                    id="studio-base-hex"
                    type="color"
                    value={draft.mapping.baseColorHex}
                    onChange={(e) =>
                      patchMapping({ baseColorHex: e.target.value })
                    }
                    className="h-7 w-9 border border-[#E5E3DC] bg-white p-0.5"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between text-[11px] text-[#57534E]">
                    <label htmlFor="studio-scale">Print Scale</label>
                    <span className="tabular-nums">{draft.mapping.scale.toFixed(2)}x</span>
                  </div>
                  <input
                    id="studio-scale"
                    type="range"
                    min={0.6}
                    max={1.5}
                    step={0.05}
                    value={draft.mapping.scale}
                    onChange={(e) => patchMapping({ scale: Number(e.target.value) })}
                    className="mt-1 w-full accent-[#181817]"
                  />
                </div>
                <div>
                  <div className="flex justify-between text-[11px] text-[#57534E]">
                    <label htmlFor="studio-offset-y">Vertical Shift</label>
                    <span className="tabular-nums">{draft.mapping.offsetY.toFixed(2)}</span>
                  </div>
                  <input
                    id="studio-offset-y"
                    type="range"
                    min={-0.3}
                    max={0.3}
                    step={0.02}
                    value={draft.mapping.offsetY}
                    onChange={(e) => patchMapping({ offsetY: Number(e.target.value) })}
                    className="mt-1 w-full accent-[#181817]"
                  />
                </div>
              </div>
            </div>

            {/* 5. Listing Details */}
            <div className="space-y-3 border-t border-[#E5E3DC] pt-4">
              <span className="block text-xs font-semibold text-[#181817]">
                5. Product Details
              </span>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="listing-title"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Product Name
                  </label>
                  <input
                    id="listing-title"
                    type="text"
                    required
                    placeholder="e.g. Heavyweight Sage Box Tee"
                    value={draft.title}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, title: e.target.value }))
                    }
                    className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                  />
                </div>

                <div>
                  <label
                    htmlFor="listing-brand"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Brand / Label
                  </label>
                  <input
                    id="listing-brand"
                    type="text"
                    placeholder="e.g. MERIDIAN"
                    value={draft.brand}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, brand: e.target.value }))
                    }
                    className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs uppercase text-[#181817]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="listing-price"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Price (IDR)
                  </label>
                  <input
                    id="listing-price"
                    type="number"
                    min="10000"
                    step="5000"
                    required
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
                  />
                  {Number.isFinite(parsedPreviewPrice) && parsedPreviewPrice >= 10000 && (
                    <span className="mt-1 block text-[11px] tabular-nums text-[#57534E]">
                      {formatIDR(parsedPreviewPrice)}
                    </span>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="listing-compare-price"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Compare-At Price (optional)
                  </label>
                  <input
                    id="listing-compare-price"
                    type="number"
                    min="0"
                    step="5000"
                    placeholder="e.g. 550000"
                    value={compareInput}
                    onChange={(e) => setCompareInput(e.target.value)}
                    className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs tabular-nums text-[#181817]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label
                    htmlFor="listing-collection"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Collection
                  </label>
                  <select
                    id="listing-collection"
                    value={draft.collection}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        collection: e.target.value as CollectionTag,
                      }))
                    }
                    className="mt-1 h-[44px] w-full border border-[#E5E3DC] bg-white px-2.5 text-xs text-[#181817]"
                  >
                    <option value="new-arrivals">New Arrivals</option>
                    <option value="best-sellers">Best Sellers</option>
                    <option value="limited">Limited Drop</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="listing-badge"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Badge
                  </label>
                  <select
                    id="listing-badge"
                    value={draft.badge ?? ""}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        badge: (e.target.value || undefined) as
                          | ProductBadge
                          | undefined,
                      }))
                    }
                    className="mt-1 h-[44px] w-full border border-[#E5E3DC] bg-white px-2.5 text-xs text-[#181817]"
                  >
                    <option value="">None</option>
                    <option value="NEW">New</option>
                    <option value="BEST SELLER">Best Seller</option>
                    <option value="LIMITED">Limited</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="listing-stock"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Stock
                  </label>
                  <select
                    id="listing-stock"
                    value={draft.stockStatus}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        stockStatus:
                          e.target.value === "Limited Stock"
                            ? "Limited Stock"
                            : "In Stock",
                      }))
                    }
                    className="mt-1 h-[44px] w-full border border-[#E5E3DC] bg-white px-2.5 text-xs text-[#181817]"
                  >
                    <option value="In Stock">In Stock</option>
                    <option value="Limited Stock">Limited Stock</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="listing-color-tag"
                    className="block text-xs font-medium text-[#181817]"
                  >
                    Color &amp; Fabric
                  </label>
                  <input
                    id="listing-color-tag"
                    type="text"
                    placeholder="e.g. Sage Cotton"
                    value={draft.colorTag}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, colorTag: e.target.value }))
                    }
                    className="mt-1 min-h-[44px] w-full border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                  />
                </div>

                <div className="flex items-end pb-2">
                  <label className="flex items-center gap-2 text-xs font-medium text-[#181817]">
                    <input
                      type="checkbox"
                      checked={Boolean(draft.isFeatured)}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          isFeatured: e.target.checked,
                        }))
                      }
                      className="h-4 w-4 accent-[#181817]"
                    />
                    Pin in New &amp; Featured shelf
                  </label>
                </div>
              </div>

              <div>
                <span className="block text-xs font-medium text-[#181817]">
                  Available Sizes
                </span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(draft.category === "top"
                    ? ["XS", "S", "M", "L", "XL", "XXL"]
                    : ["28", "30", "32", "34", "36", "S", "M", "L", "XL"]
                  ).map((sz) => {
                    const active = draft.sizes.includes(sz);
                    return (
                      <button
                        key={sz}
                        type="button"
                        aria-pressed={active}
                        onClick={() => {
                          setDraft((prev) => {
                            const has = prev.sizes.includes(sz);
                            if (has && prev.sizes.length <= 1) return prev;
                            const nextSizes = has
                              ? prev.sizes.filter((s) => s !== sz)
                              : [...prev.sizes, sz];
                            const nextSelected = nextSizes.includes(prev.selectedSize)
                              ? prev.selectedSize
                              : nextSizes[0];
                            return {
                              ...prev,
                              sizes: nextSizes,
                              selectedSize: nextSelected,
                            };
                          });
                        }}
                        className={`min-h-[38px] min-w-[42px] border px-2.5 text-xs font-medium tabular-nums transition-colors ${
                          active
                            ? "border-[#181817] bg-[#181817] text-white"
                            : "border-[#E5E3DC] bg-white text-[#181817] hover:border-[#181817]"
                        }`}
                      >
                        {sz}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Promo / Discount Product Tags */}
              <div>
                <label
                  htmlFor="listing-promo-tags"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Promo &amp; Discount Tags (optional)
                </label>
                <p className="mt-0.5 text-[11px] text-[#57534E]">
                  Digunakan untuk menargetkan diskon member baru atau voucher ke
                  produk tertentu.
                </p>
                <div className="mt-1.5 flex gap-2">
                  <input
                    id="listing-promo-tags"
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const clean = normalizeProductTag(tagInput);
                        if (!clean) return;
                        setDraft((prev) => ({
                          ...prev,
                          tags: Array.from(
                            new Set([...(prev.tags ?? []), clean])
                          ),
                        }));
                        setTagInput("");
                      }
                    }}
                    placeholder="e.g. new-member, promo, essentials"
                    className="min-h-[40px] flex-1 border border-[#E5E3DC] bg-white px-3 text-xs text-[#181817]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const clean = normalizeProductTag(tagInput);
                      if (!clean) return;
                      setDraft((prev) => ({
                        ...prev,
                        tags: Array.from(
                          new Set([...(prev.tags ?? []), clean])
                        ),
                      }));
                      setTagInput("");
                    }}
                    className="min-h-[40px] border border-[#181817] bg-white px-3 text-xs font-medium text-[#181817] hover:bg-[#181817] hover:text-white"
                  >
                    + Add Tag
                  </button>
                </div>

                <div className="mt-2 flex flex-wrap gap-1.5">
                  {["new-member", "member-promo", "essentials", "flash-sale"].map(
                    (preset) => {
                      const active = (draft.tags ?? []).includes(preset);
                      return (
                        <button
                          key={preset}
                          type="button"
                          onClick={() =>
                            setDraft((prev) => {
                              const cur = prev.tags ?? [];
                              return {
                                ...prev,
                                tags: cur.includes(preset)
                                  ? cur.filter((t) => t !== preset)
                                  : [...cur, preset],
                              };
                            })
                          }
                          className={`border px-2 py-1 text-[10px] font-medium transition-colors ${
                            active
                              ? "border-[#181817] bg-[#181817] text-white"
                              : "border-[#E5E3DC] bg-[#FAFAFA] text-[#57534E] hover:border-[#181817]"
                          }`}
                        >
                          #{preset}
                        </button>
                      );
                    }
                  )}
                </div>

                {(draft.tags ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {(draft.tags ?? []).map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 border border-[#181817] bg-[#FAFAFA] px-2 py-0.5 text-[11px] font-medium text-[#181817]"
                      >
                        #{t}
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              tags: (prev.tags ?? []).filter((x) => x !== t),
                            }))
                          }
                          aria-label={`Remove tag ${t}`}
                          className="ml-0.5 text-[#881337] hover:underline"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label
                  htmlFor="listing-description"
                  className="block text-xs font-medium text-[#181817]"
                >
                  Description
                </label>
                <textarea
                  id="listing-description"
                  rows={2}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, description: e.target.value }))
                  }
                  className="mt-1 w-full border border-[#E5E3DC] bg-white p-2.5 text-xs text-[#181817]"
                />
              </div>
            </div>
          </div>

          {/* Sticky Submit Footer */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-[#E5E3DC] bg-[#FAFAFA] px-5 py-3.5">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] border border-[#E5E3DC] bg-white px-4 text-xs font-medium text-[#181817] hover:bg-[#F5F5F5]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving || isUploading}
              className="min-h-[48px] flex-1 bg-[#181817] px-5 text-xs font-medium tracking-wide text-white transition-colors hover:bg-[#333330] disabled:opacity-60"
            >
              {isSaving
                ? "Saving..."
                : editingProduct
                ? "Save Changes"
                : mode === "admin"
                ? "Create Product"
                : "Publish Piece"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
