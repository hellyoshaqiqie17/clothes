export type ProductCategory = "top" | "bottom";

export type TopCut = "tee" | "longsleeve" | "knit" | "hoodie" | "jacket";
export type BottomCut = "baggy-denim" | "cargo" | "trouser" | "shorts";
export type GarmentCut = TopCut | BottomCut;

export type CollectionTag = "new-arrivals" | "best-sellers" | "limited";
export type ProductBadge = "NEW" | "BEST SELLER" | "LIMITED";

export type ProjectionMode = "auto-garment" | "all-over-pattern" | "chest-graphic";
export type ViewerAngle = "front" | "three-quarter" | "side" | "back";

export interface GarmentMapping {
  frontImageUrl: string | null;
  backImageUrl: string | null;
  sleeveImageUrl: string | null;
  projectionMode: ProjectionMode;
  scale: number;
  offsetX: number;
  offsetY: number;
  backScale: number;
  backOffsetY: number;
  autoRemoveBackground: boolean;
  baseColorHex: string;
  detectedFabricLabel: string;
}

export type PresetFabricKind =
  | "graphic-tee"
  | "charcoal-knit"
  | "acid-hoodie"
  | "raw-jacket"
  | "light-denim"
  | "parachute-cargo"
  | "washed-denim"
  | "utility-shorts"
  | "custom";

export interface CatalogProduct {
  id: string;
  title: string;
  brand: string;
  season: string;
  category: ProductCategory;
  cut: GarmentCut;
  collection: CollectionTag;
  badge?: ProductBadge;
  colorTag: string;
  price: number;
  compareAtPrice?: number;
  stockStatus: "In Stock" | "Limited Stock";
  description: string;
  sizes: string[];
  selectedSize: string;
  presetKind: PresetFabricKind;
  mapping: GarmentMapping;
  isFeatured?: boolean;
  isUserPublished?: boolean;
  sortOrder?: number;
  createdAt: number;
}

export interface ProductPreviews {
  front2d: string;
  back2d: string;
  extractedHex: string;
  mappingSummary: string;
}

export interface BagItem {
  key: string;
  productId: string;
  title: string;
  brand: string;
  category: ProductCategory;
  colorTag: string;
  size: string;
  price: number;
  quantity: number;
  thumbnailUrl: string;
}

export interface HeroSlide {
  id: string;
  productId: string;
  headlineStart: string;
  headlineItalic: string;
  headlineEnd: string;
  subtitle: string;
  ctaLabel: string;
  sortOrder: number;
}

export interface StoreSettings {
  announcementText: string;
  freeShippingThreshold: number;
  standardShippingFee: number;
  storeName: string;
  storeTagline: string;
  storeLocation: string;
  supportEmail: string;
  exchangePolicyDays: number;
}

export type OrderStatus = "pending" | "confirmed" | "shipped" | "cancelled";

export interface CheckoutCustomer {
  name: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  notes?: string;
}

export interface StoreOrder {
  id: string;
  items: BagItem[];
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  shippingAddress: string;
  shippingCity: string;
  notes: string;
  subtotal: number;
  shippingFee: number;
  total: number;
  itemCount: number;
  paymentMethod: string;
  status: OrderStatus;
  createdAt: number;
}

export interface ShoppingSessionData {
  bagItems: BagItem[];
  wishlistIds: string[];
}

export interface NewsletterSubscriber {
  id: number;
  email: string;
  createdAt: number;
}

export interface StorefrontBootstrap {
  products: CatalogProduct[];
  heroSlides: HeroSlide[];
  settings: StoreSettings;
  initialBag?: BagItem[];
  initialWishlistIds?: string[];
}
