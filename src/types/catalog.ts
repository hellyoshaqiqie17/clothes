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
  tags?: string[];
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

export type PromoScope = "global" | "tags";

export interface StoreSettings {
  announcementText: string;
  freeShippingThreshold: number;
  standardShippingFee: number;
  storeName: string;
  storeTagline: string;
  storeLocation: string;
  supportEmail: string;
  exchangePolicyDays: number;
  newMemberDiscountEnabled: boolean;
  newMemberDiscountPercent: number;
  newMemberDiscountScope: PromoScope;
  newMemberDiscountTags: string[];
  newMemberDiscountMaxOrders: number;
  newMemberDiscountStackable: boolean;
}

export type MemberRole = "member" | "admin";

export interface MemberProfile {
  id: string;
  email: string;
  name: string;
  role: MemberRole;
  phone: string;
  defaultAddress: string;
  defaultCity: string;
  orderCount: number;
  newMemberEligible: boolean;
  createdAt: number;
}

export type VoucherDiscountType = "percent" | "fixed";

export interface Voucher {
  id: string;
  code: string;
  description: string;
  discountType: VoucherDiscountType;
  discountValue: number;
  maxDiscount: number | null;
  minSubtotal: number;
  scope: PromoScope;
  tags: string[];
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface CheckoutPricingQuote {
  subtotal: number;
  eligibleMemberSubtotal: number;
  memberDiscount: number;
  memberDiscountPercent: number;
  memberDiscountScope: PromoScope;
  memberDiscountTags: string[];
  memberEligible: boolean;
  memberLabel: string | null;
  voucherCode: string | null;
  voucherDiscount: number;
  voucherValid: boolean;
  voucherMessage: string | null;
  discountTotal: number;
  shippingFee: number;
  total: number;
  itemCount: number;
}

export type OrderStatus =
  | "pending"
  | "confirmed"
  | "shipped"
  | "completed"
  | "cancelled";

export type PaymentMethodType = "qris" | "va" | "payment_link";

export type VirtualAccountChannel =
  | "BCA"
  | "MANDIRI"
  | "BNI"
  | "BRI"
  | "PERMATA"
  | "BSI"
  | "CIMB"
  | "MUAMALAT"
  | "SINARMAS"
  | "BNC"
  | "MAYBANK";

export type PaymentChannelCode = "QRIS" | VirtualAccountChannel | "LINK";

export type PaymentTransactionStatus =
  | "pending"
  | "paid"
  | "expired"
  | "cancelled"
  | "failed"
  | "refunded";

export interface CheckoutPaymentSelection {
  paymentType: PaymentMethodType;
  channel: PaymentChannelCode;
}

export interface PaymentTransaction {
  id: string;
  orderId: string;
  provider: "binderpay";
  paymentType: PaymentMethodType;
  channel: PaymentChannelCode;
  trxId: string;
  contractId: string | null;
  linkId: string | null;
  externalId: string;
  amount: number;
  feeAmount: number;
  payableAmount: number;
  currency: string;
  status: PaymentTransactionStatus;
  qrContent: string | null;
  qrUrl: string | null;
  virtualAccountNo: string | null;
  virtualAccountName: string | null;
  partnerServiceId: string | null;
  customerNo: string | null;
  paymentUrl: string | null;
  referenceNo: string | null;
  issuerName: string | null;
  expiredAt: string | null;
  paidAt: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BinderPayChannelOption {
  paymentType: PaymentMethodType;
  channel: PaymentChannelCode;
  label: string;
  shortLabel: string;
  group: "instant" | "va" | "hosted";
  description: string;
}

export interface BinderPayConfigStatus {
  configured: boolean;
  env: "sandbox" | "production";
  baseUrl: string;
  partnerIdMasked: string | null;
  missingEnvVars: string[];
  channels: BinderPayChannelOption[];
  callbackUrls: {
    unified: string;
    va: string;
    qris: string;
    paymentLink: string;
  };
}

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
  shippingCourier?: string;
  trackingNumber?: string;
  shippedAt?: number | null;
  completedAt?: number | null;
  memberId?: string | null;
  voucherCode?: string | null;
  voucherDiscount?: number;
  memberDiscount?: number;
  discountTotal?: number;
  payment?: PaymentTransaction | null;
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
  initialMember?: MemberProfile | null;
}
