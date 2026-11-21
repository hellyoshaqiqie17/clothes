import crypto from "node:crypto";
import {
  DEFAULT_STORE_SETTINGS,
  normalizeProductTags,
  productMatchesPromoScope,
} from "@/data/catalogProducts";
import type {
  BagItem,
  CatalogProduct,
  CheckoutCustomer,
  CheckoutPricingQuote,
  CollectionTag,
  GarmentCut,
  GarmentMapping,
  HeroSlide,
  MemberProfile,
  NewsletterSubscriber,
  OrderStatus,
  PaymentChannelCode,
  PaymentMethodType,
  PaymentTransaction,
  PaymentTransactionStatus,
  PresetFabricKind,
  ProductBadge,
  ProductCategory,
  PromoScope,
  ShoppingSessionData,
  StoreOrder,
  StoreSettings,
  StorefrontBootstrap,
  Voucher,
  VoucherDiscountType,
} from "@/types/catalog";

/**
 * Cloudflare D1 (SQLite at the edge) via the REST API.
 * Database holds structured records only; binary assets (images/GLB) live in R2 object storage.
 */
type Param = string | number | null;
interface Stmt {
  sql: string;
  params?: Param[];
}
interface D1Meta {
  changes?: number;
  last_row_id?: number;
}
interface D1Result {
  results?: Record<string, unknown>[];
  meta?: D1Meta;
}

function d1Endpoint(): { url: string; token: string } {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const dbId = process.env.CLOUDFLARE_D1_DATABASE_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!account || !dbId || !token) {
    throw new Error(
      "Cloudflare D1 is not configured. Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_D1_DATABASE_ID and CLOUDFLARE_API_TOKEN."
    );
  }
  return {
    url: `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${dbId}/query`,
    token,
  };
}

async function d1Request(body: unknown): Promise<D1Result[]> {
  const { url, token } = d1Endpoint();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json()) as {
    success: boolean;
    errors?: { message: string }[];
    result?: D1Result[];
  };
  if (!res.ok || !json.success) {
    throw new Error(
      `D1 query failed: ${json.errors?.map((e) => e.message).join("; ") || res.status}`
    );
  }
  return json.result ?? [];
}

async function all<T>(sql: string, params: Param[] = []): Promise<T[]> {
  const [r] = await d1Request({ sql, params });
  return (r?.results ?? []) as unknown as T[];
}

async function first<T>(sql: string, params: Param[] = []): Promise<T | undefined> {
  const rows = await all<T>(sql, params);
  return rows[0];
}

async function run(
  sql: string,
  params: Param[] = []
): Promise<{ changes: number; lastRowId: number }> {
  const [r] = await d1Request({ sql, params });
  return {
    changes: Number(r?.meta?.changes ?? 0),
    lastRowId: Number(r?.meta?.last_row_id ?? 0),
  };
}

async function batch(stmts: Stmt[]): Promise<void> {
  if (stmts.length === 0) return;
  await d1Request({
    batch: stmts.map((s) => ({ sql: s.sql, params: s.params ?? [] })),
  });
}

interface ProductRow {
  id: string;
  title: string;
  brand: string;
  season: string;
  category: string;
  cut: string;
  collection: string;
  badge: string | null;
  color_tag: string;
  price: number;
  compare_at_price: number | null;
  stock_status: string;
  description: string;
  sizes_json: string;
  selected_size: string;
  preset_kind: string;
  mapping_json: string;
  is_featured: number;
  is_user_published: number;
  sort_order: number;
  tags_json?: string | null;
  created_at: number;
  updated_at: number;
}

interface HeroSlideRow {
  id: string;
  product_id: string;
  headline_start: string;
  headline_italic: string;
  headline_end: string;
  subtitle: string;
  cta_label: string;
  sort_order: number;
}

interface SettingRow {
  key: string;
  value: string;
}

interface OrderRow {
  id: string;
  items_json: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  shipping_address: string;
  shipping_city: string;
  notes: string;
  subtotal: number;
  shipping_fee: number;
  total: number;
  item_count: number;
  payment_method: string;
  status: string;
  created_at: number;
  member_id?: string | null;
  voucher_code?: string | null;
  voucher_discount?: number | null;
  member_discount?: number | null;
  discount_total?: number | null;
  shipping_courier?: string | null;
  tracking_number?: string | null;
  shipped_at?: number | null;
  completed_at?: number | null;
}

interface SubscriberRow {
  id: number;
  email: string;
  created_at: number;
}

interface SessionRow {
  id: string;
  bag_json: string;
  wishlist_json: string;
  updated_at: number;
}

interface PaymentTransactionRow {
  id: string;
  order_id: string;
  provider: string;
  payment_type: string;
  channel: string;
  trx_id: string;
  contract_id: string | null;
  link_id: string | null;
  external_id: string;
  amount: number;
  fee_amount: number;
  payable_amount: number;
  currency: string;
  status: string;
  qr_content: string | null;
  qr_url: string | null;
  virtual_account_no: string | null;
  virtual_account_name: string | null;
  partner_service_id: string | null;
  customer_no: string | null;
  payment_url: string | null;
  reference_no: string | null;
  issuer_name: string | null;
  expired_at: string | null;
  paid_at: string | null;
  raw_response_json: string | null;
  callback_payload_json: string | null;
  created_at: number;
  updated_at: number;
}

interface WebhookLogRow {
  id: number;
  external_id: string | null;
  event_type: string;
  trx_id: string | null;
  partner_id: string | null;
  signature_valid: number;
  http_status: number;
  response_code: string | null;
}

function rowToPaymentTransaction(row: PaymentTransactionRow): PaymentTransaction {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: "binderpay",
    paymentType: row.payment_type as PaymentMethodType,
    channel: row.channel as PaymentChannelCode,
    trxId: row.trx_id,
    contractId: row.contract_id,
    linkId: row.link_id,
    externalId: row.external_id,
    amount: Number(row.amount) || 0,
    feeAmount: Number(row.fee_amount) || 0,
    payableAmount: Number(row.payable_amount) || Number(row.amount) || 0,
    currency: row.currency || "IDR",
    status: (row.status as PaymentTransactionStatus) || "pending",
    qrContent: row.qr_content,
    qrUrl: row.qr_url,
    virtualAccountNo: row.virtual_account_no,
    virtualAccountName: row.virtual_account_name,
    partnerServiceId: row.partner_service_id,
    customerNo: row.customer_no,
    paymentUrl: row.payment_url,
    referenceNo: row.reference_no,
    issuerName: row.issuer_name,
    expiredAt: row.expired_at,
    paidAt: row.paid_at,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

function rowToProduct(row: ProductRow): CatalogProduct {
  let sizes: string[] = ["S", "M", "L", "XL"];
  try {
    const parsed = JSON.parse(row.sizes_json);
    if (Array.isArray(parsed) && parsed.length > 0) sizes = parsed.map(String);
  } catch {
    // keep fallback
  }

  let mapping: GarmentMapping;
  try {
    mapping = JSON.parse(row.mapping_json) as GarmentMapping;
  } catch {
    mapping = {
      frontImageUrl: null,
      backImageUrl: null,
      sleeveImageUrl: null,
      projectionMode: "auto-garment",
      scale: 1,
      offsetX: 0,
      offsetY: 0,
      backScale: 1,
      backOffsetY: 0,
      autoRemoveBackground: true,
      baseColorHex: "#D8D4CC",
      detectedFabricLabel: "CUSTOM FABRIC",
    };
  }

  let tags: string[] = [];
  try {
    if (row.tags_json) {
      tags = normalizeProductTags(JSON.parse(row.tags_json));
    }
  } catch {
    tags = [];
  }

  return {
    id: row.id,
    title: row.title,
    brand: row.brand,
    season: row.season,
    category: row.category as ProductCategory,
    cut: row.cut as GarmentCut,
    collection: row.collection as CollectionTag,
    badge: (row.badge ?? undefined) as ProductBadge | undefined,
    colorTag: row.color_tag,
    price: row.price,
    compareAtPrice: row.compare_at_price ?? undefined,
    stockStatus:
      row.stock_status === "Limited Stock" ? "Limited Stock" : "In Stock",
    description: row.description,
    sizes,
    selectedSize: row.selected_size,
    presetKind: row.preset_kind as PresetFabricKind,
    mapping,
    isFeatured: row.is_featured === 1,
    isUserPublished: row.is_user_published === 1,
    sortOrder: row.sort_order,
    tags,
    createdAt: row.created_at,
  };
}

function rowToHeroSlide(row: HeroSlideRow): HeroSlide {
  return {
    id: row.id,
    productId: row.product_id,
    headlineStart: row.headline_start,
    headlineItalic: row.headline_italic,
    headlineEnd: row.headline_end,
    subtitle: row.subtitle,
    ctaLabel: row.cta_label,
    sortOrder: row.sort_order,
  };
}

function rowToOrder(row: OrderRow): StoreOrder {
  let items: BagItem[] = [];
  try {
    const parsed = JSON.parse(row.items_json);
    if (Array.isArray(parsed)) items = parsed as BagItem[];
  } catch {
    // ignore malformed json
  }
  const shippingFee = Number.isFinite(row.shipping_fee) ? row.shipping_fee : 0;
  const total =
    Number.isFinite(row.total) && row.total > 0
      ? row.total
      : row.subtotal + shippingFee;
  return {
    id: row.id,
    items,
    customerName: row.customer_name || "",
    customerEmail: row.customer_email || "",
    customerPhone: row.customer_phone || "",
    shippingAddress: row.shipping_address || "",
    shippingCity: row.shipping_city || "",
    notes: row.notes || "",
    subtotal: row.subtotal,
    shippingFee,
    total,
    itemCount: row.item_count,
    paymentMethod:
      row.payment_method || "Manual Confirmation (Pay on Delivery / Transfer)",
    status: (row.status as OrderStatus) || "pending",
    createdAt: row.created_at,
    shippingCourier: row.shipping_courier || "",
    trackingNumber: row.tracking_number || "",
    shippedAt:
      row.shipped_at !== undefined && row.shipped_at !== null
        ? Number(row.shipped_at) || null
        : null,
    completedAt:
      row.completed_at !== undefined && row.completed_at !== null
        ? Number(row.completed_at) || null
        : null,
    memberId: row.member_id ?? null,
    voucherCode: row.voucher_code ?? null,
    voucherDiscount: Number(row.voucher_discount ?? 0) || 0,
    memberDiscount: Number(row.member_discount ?? 0) || 0,
    discountTotal: Number(row.discount_total ?? 0) || 0,
  };
}
const PRODUCT_COLUMNS = `id, title, brand, season, category, cut, collection, badge, color_tag,
  price, compare_at_price, stock_status, description, sizes_json,
  selected_size, preset_kind, mapping_json, is_featured,
  is_user_published, sort_order, tags_json, created_at, updated_at`;
const PRODUCT_PLACEHOLDERS = new Array(23).fill("?").join(", ");

export async function listProducts(): Promise<CatalogProduct[]> {
  const rows = await all<ProductRow>(
    "SELECT * FROM products ORDER BY created_at DESC, sort_order ASC"
  );
  return rows.map(rowToProduct);
}

export async function getProductById(id: string): Promise<CatalogProduct | null> {
  const row = await first<ProductRow>("SELECT * FROM products WHERE id = ?", [id]);
  return row ? rowToProduct(row) : null;
}

export async function createProduct(
  input: Omit<CatalogProduct, "id" | "createdAt"> & { id?: string }
): Promise<CatalogProduct> {
  const now = Date.now();
  const id = input.id?.trim() || `prod-${crypto.randomBytes(4).toString("hex")}`;

  await run(
    `INSERT INTO products (${PRODUCT_COLUMNS}) VALUES (${PRODUCT_PLACEHOLDERS})`,
    [
      id,
      input.title.trim(),
      input.brand.trim().toUpperCase() || "MERIDIAN",
      input.season || "SS27",
      input.category,
      input.cut,
      input.collection,
      input.badge ?? null,
      input.colorTag.trim().toUpperCase() || "CUSTOM FABRIC",
      Math.round(input.price),
      input.compareAtPrice && input.compareAtPrice > input.price
        ? Math.round(input.compareAtPrice)
        : null,
      input.stockStatus || "In Stock",
      input.description.trim(),
      JSON.stringify(input.sizes.length > 0 ? input.sizes : ["S", "M", "L", "XL"]),
      input.selectedSize || input.sizes[0] || "L",
      input.presetKind || "custom",
      JSON.stringify(input.mapping),
      input.isFeatured ? 1 : 0,
      input.isUserPublished ? 1 : 0,
      input.sortOrder ?? 0,
      JSON.stringify(normalizeProductTags(input.tags ?? [])),
      now,
      now,
    ]
  );

  return (await getProductById(id))!;
}

export async function updateProduct(
  id: string,
  patch: Partial<Omit<CatalogProduct, "badge" | "compareAtPrice">> & {
    badge?: ProductBadge | null;
    compareAtPrice?: number | null;
  }
): Promise<CatalogProduct | null> {
  const existing = await getProductById(id);
  if (!existing) return null;

  const nextSizes =
    patch.sizes && patch.sizes.length > 0 ? patch.sizes : existing.sizes;
  const nextPrice =
    patch.price !== undefined ? Math.round(patch.price) : existing.price;
  const nextCompareAt =
    patch.compareAtPrice === null
      ? undefined
      : patch.compareAtPrice !== undefined
      ? patch.compareAtPrice > nextPrice
        ? Math.round(patch.compareAtPrice)
        : undefined
      : existing.compareAtPrice;
  const nextBadge =
    patch.badge === null
      ? undefined
      : patch.badge !== undefined
      ? patch.badge
      : existing.badge;

  const merged: CatalogProduct = {
    ...existing,
    ...patch,
    id: existing.id,
    price: nextPrice,
    compareAtPrice: nextCompareAt,
    badge: nextBadge,
    mapping: patch.mapping
      ? { ...existing.mapping, ...patch.mapping }
      : existing.mapping,
    sizes: nextSizes,
    tags:
      patch.tags !== undefined
        ? normalizeProductTags(patch.tags)
        : existing.tags ?? [],
    selectedSize:
      patch.selectedSize && nextSizes.includes(patch.selectedSize)
        ? patch.selectedSize
        : nextSizes.includes(existing.selectedSize)
        ? existing.selectedSize
        : nextSizes[0],
  };

  await run(
    `UPDATE products SET
      title = ?, brand = ?, season = ?, category = ?, cut = ?, collection = ?,
      badge = ?, color_tag = ?, price = ?, compare_at_price = ?, stock_status = ?,
      description = ?, sizes_json = ?, selected_size = ?, preset_kind = ?,
      mapping_json = ?, is_featured = ?, is_user_published = ?, sort_order = ?,
      tags_json = ?, updated_at = ?
    WHERE id = ?`,
    [
      merged.title.trim(),
      merged.brand.trim().toUpperCase() || "MERIDIAN",
      merged.season || "SS27",
      merged.category,
      merged.cut,
      merged.collection,
      merged.badge ?? null,
      merged.colorTag.trim().toUpperCase() || "CUSTOM FABRIC",
      merged.price,
      merged.compareAtPrice && merged.compareAtPrice > merged.price
        ? merged.compareAtPrice
        : null,
      merged.stockStatus,
      merged.description.trim(),
      JSON.stringify(merged.sizes),
      merged.selectedSize,
      merged.presetKind,
      JSON.stringify(merged.mapping),
      merged.isFeatured ? 1 : 0,
      merged.isUserPublished ? 1 : 0,
      merged.sortOrder ?? 0,
      JSON.stringify(merged.tags ?? []),
      Date.now(),
      id,
    ]
  );

  return getProductById(id);
}

export async function deleteProduct(id: string): Promise<boolean> {
  // hero_slides references products with ON DELETE CASCADE, but D1 REST does not enforce
  // foreign keys per request, so remove dependent slides explicitly in one batch.
  await batch([
    { sql: "DELETE FROM hero_slides WHERE product_id = ?", params: [id] },
  ]);
  const res = await run("DELETE FROM products WHERE id = ?", [id]);
  return res.changes > 0;
}

export async function listHeroSlides(): Promise<HeroSlide[]> {
  const rows = await all<HeroSlideRow>(
    "SELECT * FROM hero_slides ORDER BY sort_order ASC"
  );
  return rows.map(rowToHeroSlide);
}

export async function replaceHeroSlides(slides: HeroSlide[]): Promise<HeroSlide[]> {
  const existingIds = new Set((await listProducts()).map((p) => p.id));
  const validSlides = slides.filter((s) => existingIds.has(s.productId));
  if (validSlides.length === 0) {
    throw new Error("Hero slides must reference at least one existing product.");
  }

  // Single D1 batch = atomic transaction
  const stmts: Stmt[] = [{ sql: "DELETE FROM hero_slides" }];
  validSlides.forEach((s, index) => {
    stmts.push({
      sql: `INSERT INTO hero_slides (
        id, product_id, headline_start, headline_italic, headline_end,
        subtitle, cta_label, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        s.id || `slide-${crypto.randomBytes(3).toString("hex")}`,
        s.productId,
        s.headlineStart,
        s.headlineItalic,
        s.headlineEnd,
        s.subtitle,
        s.ctaLabel,
        index + 1,
      ],
    });
  });
  await batch(stmts);
  return listHeroSlides();
}

export async function getStoreSettings(): Promise<StoreSettings> {
  const rows = await all<SettingRow>("SELECT key, value FROM store_settings");
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const parsedThreshold = Number(map.get("freeShippingThreshold"));
  const parsedShippingFee = Number(map.get("standardShippingFee"));
  const parsedExchangeDays = Number(map.get("exchangePolicyDays"));
  const parsedMemberPct = Number(map.get("newMemberDiscountPercent"));
  const parsedMemberMaxOrders = Number(map.get("newMemberDiscountMaxOrders"));

  let newMemberDiscountTags: string[] = DEFAULT_STORE_SETTINGS.newMemberDiscountTags;
  try {
    const rawTags = map.get("newMemberDiscountTags");
    if (rawTags) newMemberDiscountTags = normalizeProductTags(JSON.parse(rawTags));
  } catch {
    newMemberDiscountTags = [];
  }

  const rawScope = map.get("newMemberDiscountScope");
  const newMemberDiscountScope: PromoScope =
    rawScope === "tags" ? "tags" : "global";

  const rawEnabled = map.get("newMemberDiscountEnabled");
  const newMemberDiscountEnabled =
    rawEnabled !== undefined
      ? rawEnabled === "true" || rawEnabled === "1"
      : DEFAULT_STORE_SETTINGS.newMemberDiscountEnabled;

  const rawStackable = map.get("newMemberDiscountStackable");
  const newMemberDiscountStackable =
    rawStackable !== undefined
      ? rawStackable === "true" || rawStackable === "1"
      : DEFAULT_STORE_SETTINGS.newMemberDiscountStackable;

  return {
    announcementText:
      map.get("announcementText") ?? DEFAULT_STORE_SETTINGS.announcementText,
    freeShippingThreshold:
      Number.isFinite(parsedThreshold) && parsedThreshold >= 0
        ? parsedThreshold
        : DEFAULT_STORE_SETTINGS.freeShippingThreshold,
    standardShippingFee:
      Number.isFinite(parsedShippingFee) && parsedShippingFee >= 0
        ? parsedShippingFee
        : DEFAULT_STORE_SETTINGS.standardShippingFee,
    storeName: map.get("storeName") ?? DEFAULT_STORE_SETTINGS.storeName,
    storeTagline: map.get("storeTagline") ?? DEFAULT_STORE_SETTINGS.storeTagline,
    storeLocation:
      map.get("storeLocation") ?? DEFAULT_STORE_SETTINGS.storeLocation,
    supportEmail: map.get("supportEmail") ?? DEFAULT_STORE_SETTINGS.supportEmail,
    exchangePolicyDays:
      Number.isFinite(parsedExchangeDays) && parsedExchangeDays >= 1
        ? Math.round(parsedExchangeDays)
        : DEFAULT_STORE_SETTINGS.exchangePolicyDays,
    newMemberDiscountEnabled,
    newMemberDiscountPercent:
      Number.isFinite(parsedMemberPct) && parsedMemberPct >= 0 && parsedMemberPct <= 90
        ? Math.round(parsedMemberPct)
        : DEFAULT_STORE_SETTINGS.newMemberDiscountPercent,
    newMemberDiscountScope,
    newMemberDiscountTags,
    newMemberDiscountMaxOrders:
      Number.isFinite(parsedMemberMaxOrders) && parsedMemberMaxOrders >= 0
        ? Math.round(parsedMemberMaxOrders)
        : DEFAULT_STORE_SETTINGS.newMemberDiscountMaxOrders,
    newMemberDiscountStackable,
  };
}

export async function updateStoreSettings(
  patch: Partial<StoreSettings>
): Promise<StoreSettings> {
  const upsertSql =
    "INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value";
  const stmts: Stmt[] = [];
  const upsert = (key: string, value: string) =>
    stmts.push({ sql: upsertSql, params: [key, value] });

  if (patch.announcementText !== undefined) {
    upsert("announcementText", patch.announcementText.trim());
  }
  if (
    patch.freeShippingThreshold !== undefined &&
    Number.isFinite(patch.freeShippingThreshold) &&
    patch.freeShippingThreshold >= 0
  ) {
    upsert("freeShippingThreshold", String(Math.round(patch.freeShippingThreshold)));
  }
  if (
    patch.standardShippingFee !== undefined &&
    Number.isFinite(patch.standardShippingFee) &&
    patch.standardShippingFee >= 0
  ) {
    upsert("standardShippingFee", String(Math.round(patch.standardShippingFee)));
  }
  if (patch.storeName !== undefined) {
    upsert("storeName", patch.storeName.trim() || "Meridian");
  }
  if (patch.storeTagline !== undefined) {
    upsert("storeTagline", patch.storeTagline.trim());
  }
  if (patch.storeLocation !== undefined) {
    upsert(
      "storeLocation",
      patch.storeLocation.trim() || DEFAULT_STORE_SETTINGS.storeLocation
    );
  }
  if (patch.supportEmail !== undefined) {
    upsert(
      "supportEmail",
      patch.supportEmail.trim() || DEFAULT_STORE_SETTINGS.supportEmail
    );
  }
  if (
    patch.exchangePolicyDays !== undefined &&
    Number.isFinite(patch.exchangePolicyDays) &&
    patch.exchangePolicyDays >= 1
  ) {
    upsert(
      "exchangePolicyDays",
      String(Math.min(90, Math.round(patch.exchangePolicyDays)))
    );
  }
  if (patch.newMemberDiscountEnabled !== undefined) {
    upsert("newMemberDiscountEnabled", patch.newMemberDiscountEnabled ? "true" : "false");
  }
  if (
    patch.newMemberDiscountPercent !== undefined &&
    Number.isFinite(patch.newMemberDiscountPercent)
  ) {
    upsert(
      "newMemberDiscountPercent",
      String(Math.max(0, Math.min(90, Math.round(patch.newMemberDiscountPercent))))
    );
  }
  if (patch.newMemberDiscountScope !== undefined) {
    upsert(
      "newMemberDiscountScope",
      patch.newMemberDiscountScope === "tags" ? "tags" : "global"
    );
  }
  if (patch.newMemberDiscountTags !== undefined) {
    upsert(
      "newMemberDiscountTags",
      JSON.stringify(normalizeProductTags(patch.newMemberDiscountTags))
    );
  }
  if (
    patch.newMemberDiscountMaxOrders !== undefined &&
    Number.isFinite(patch.newMemberDiscountMaxOrders)
  ) {
    upsert(
      "newMemberDiscountMaxOrders",
      String(Math.max(0, Math.min(99, Math.round(patch.newMemberDiscountMaxOrders))))
    );
  }
  if (patch.newMemberDiscountStackable !== undefined) {
    upsert(
      "newMemberDiscountStackable",
      patch.newMemberDiscountStackable ? "true" : "false"
    );
  }
  await batch(stmts);
  return getStoreSettings();
}

export interface PreparedOrderQuote {
  id: string;
  verifiedItems: BagItem[];
  subtotal: number;
  shippingFee: number;
  total: number;
  itemCount: number;
  settings: StoreSettings;
  memberId: string | null;
  voucherId: string | null;
  voucherCode: string | null;
  voucherDiscount: number;
  memberDiscount: number;
  discountTotal: number;
  pricing: CheckoutPricingQuote;
}

export interface CreatePaymentRecordInput {
  orderId: string;
  paymentType: PaymentMethodType;
  channel: PaymentChannelCode;
  trxId: string;
  contractId?: string | null;
  linkId?: string | null;
  externalId: string;
  amount: number;
  feeAmount?: number;
  payableAmount?: number;
  currency?: string;
  status?: PaymentTransactionStatus;
  qrContent?: string | null;
  qrUrl?: string | null;
  virtualAccountNo?: string | null;
  virtualAccountName?: string | null;
  partnerServiceId?: string | null;
  customerNo?: string | null;
  paymentUrl?: string | null;
  referenceNo?: string | null;
  issuerName?: string | null;
  expiredAt?: string | null;
  paidAt?: string | null;
  rawResponse?: unknown;
}

const PAYMENT_TX_INSERT_SQL = `INSERT INTO payment_transactions (
  id, order_id, provider, payment_type, channel, trx_id, contract_id, link_id,
  external_id, amount, fee_amount, payable_amount, currency, status,
  qr_content, qr_url, virtual_account_no, virtual_account_name,
  partner_service_id, customer_no, payment_url, reference_no, issuer_name,
  expired_at, paid_at, raw_response_json, callback_payload_json, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

function buildPaymentInsertParams(
  input: CreatePaymentRecordInput,
  now: number
): { id: string; params: Param[] } {
  const id = `pay-${crypto.randomBytes(6).toString("hex")}`;
  const amount = Math.round(input.amount);
  const feeAmount = Math.round(input.feeAmount ?? 0);
  const payableAmount = Math.round(input.payableAmount ?? amount + feeAmount);
  return {
    id,
    params: [
      id,
      input.orderId,
      "binderpay",
      input.paymentType,
      input.channel,
      input.trxId,
      input.contractId ?? null,
      input.linkId ?? null,
      input.externalId,
      amount,
      feeAmount,
      payableAmount,
      input.currency || "IDR",
      input.status || "pending",
      input.qrContent ?? null,
      input.qrUrl ?? null,
      input.virtualAccountNo ?? null,
      input.virtualAccountName ?? null,
      input.partnerServiceId ?? null,
      input.customerNo ?? null,
      input.paymentUrl ?? null,
      input.referenceNo ?? null,
      input.issuerName ?? null,
      input.expiredAt ?? null,
      input.paidAt ?? null,
      input.rawResponse ? JSON.stringify(input.rawResponse) : null,
      null,
      now,
      now,
    ],
  };
}

export async function listOrders(): Promise<StoreOrder[]> {
  const [orderRows, paymentRows] = await Promise.all([
    all<OrderRow>("SELECT * FROM orders ORDER BY created_at DESC"),
    all<PaymentTransactionRow>(
      "SELECT * FROM payment_transactions ORDER BY created_at DESC"
    ),
  ]);

  const latestPaymentByOrder = new Map<string, PaymentTransaction>();
  for (const pRow of paymentRows) {
    if (!latestPaymentByOrder.has(pRow.order_id)) {
      latestPaymentByOrder.set(pRow.order_id, rowToPaymentTransaction(pRow));
    }
  }

  return orderRows.map((row) => ({
    ...rowToOrder(row),
    payment: latestPaymentByOrder.get(row.id) ?? null,
  }));
}

export async function getOrderById(id: string): Promise<StoreOrder | null> {
  const normalized = id.trim().toUpperCase();
  if (!normalized) return null;
  const row = await first<OrderRow>("SELECT * FROM orders WHERE UPPER(id) = ?", [
    normalized,
  ]);
  if (!row) return null;
  const payment = await getLatestPaymentForOrder(row.id);
  return { ...rowToOrder(row), payment };
}

export async function getLatestPaymentForOrder(
  orderId: string
): Promise<PaymentTransaction | null> {
  const row = await first<PaymentTransactionRow>(
    "SELECT * FROM payment_transactions WHERE UPPER(order_id) = ? ORDER BY created_at DESC LIMIT 1",
    [orderId.trim().toUpperCase()]
  );
  return row ? rowToPaymentTransaction(row) : null;
}

export async function getPaymentByLookup(lookup: {
  trxId?: string | null;
  contractId?: string | null;
  linkId?: string | null;
}): Promise<PaymentTransaction | null> {
  if (lookup.trxId?.trim()) {
    const byTrx = await first<PaymentTransactionRow>(
      "SELECT * FROM payment_transactions WHERE trx_id = ? LIMIT 1",
      [lookup.trxId.trim()]
    );
    if (byTrx) return rowToPaymentTransaction(byTrx);
  }
  if (lookup.linkId?.trim()) {
    const byLink = await first<PaymentTransactionRow>(
      "SELECT * FROM payment_transactions WHERE link_id = ? LIMIT 1",
      [lookup.linkId.trim()]
    );
    if (byLink) return rowToPaymentTransaction(byLink);
  }
  if (lookup.contractId?.trim()) {
    const byContract = await first<PaymentTransactionRow>(
      "SELECT * FROM payment_transactions WHERE contract_id = ? LIMIT 1",
      [lookup.contractId.trim()]
    );
    if (byContract) return rowToPaymentTransaction(byContract);
  }
  return null;
}

export async function prepareOrderQuote(
  rawItems: BagItem[],
  opts?: {
    member?: MemberProfile | null;
    voucherCode?: string | null;
    requireValidVoucher?: boolean;
  }
): Promise<PreparedOrderQuote> {
  const [catalog, settings] = await Promise.all([
    listProducts(),
    getStoreSettings(),
  ]);
  const catalogById = new Map(catalog.map((p) => [p.id, p]));

  const verifiedItems: BagItem[] = [];
  const itemProducts: { item: BagItem; product: CatalogProduct }[] = [];
  for (const item of rawItems) {
    const qty = Math.max(1, Math.min(20, Math.round(Number(item.quantity) || 1)));
    const dbProd = catalogById.get(item.productId);
    if (!dbProd) {
      throw new Error(
        `Product "${item.title || item.productId}" is no longer available in the catalog.`
      );
    }
    const validSize =
      item.size && dbProd.sizes.includes(item.size)
        ? item.size
        : dbProd.selectedSize || dbProd.sizes[0] || "L";
    const verified: BagItem = {
      key: `${dbProd.id}:${validSize}:${dbProd.title}`,
      productId: dbProd.id,
      title: dbProd.title,
      brand: dbProd.brand,
      category: dbProd.category,
      colorTag: dbProd.colorTag,
      size: validSize,
      price: dbProd.price,
      quantity: qty,
      thumbnailUrl: dbProd.mapping.frontImageUrl || item.thumbnailUrl || "",
    };
    verifiedItems.push(verified);
    itemProducts.push({ item: verified, product: dbProd });
  }

  if (verifiedItems.length === 0) {
    throw new Error("Order must include at least one valid catalog item.");
  }

  const id = `ORD-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const subtotal = Math.round(
    verifiedItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
  );
  const itemCount = verifiedItems.reduce((sum, i) => sum + i.quantity, 0);

  // 1. Authoritative Member Discount calculation
  const member = opts?.member ?? null;
  const memberPromoActive =
    settings.newMemberDiscountEnabled && settings.newMemberDiscountPercent > 0;
  const memberEligible = Boolean(
    memberPromoActive &&
      member &&
      (settings.newMemberDiscountMaxOrders === 0 ||
        member.orderCount < settings.newMemberDiscountMaxOrders)
  );

  const eligibleMemberSubtotal = Math.round(
    itemProducts.reduce((sum, entry) => {
      if (
        productMatchesPromoScope(
          entry.product,
          settings.newMemberDiscountScope,
          settings.newMemberDiscountTags
        )
      ) {
        return sum + entry.item.price * entry.item.quantity;
      }
      return sum;
    }, 0)
  );

  let memberDiscount = 0;
  let memberLabel: string | null = null;
  if (memberEligible && eligibleMemberSubtotal > 0) {
    memberDiscount = Math.round(
      eligibleMemberSubtotal * (settings.newMemberDiscountPercent / 100)
    );
    memberLabel =
      settings.newMemberDiscountMaxOrders === 1
        ? `New Member (${settings.newMemberDiscountPercent}%)`
        : `Member Promo (${settings.newMemberDiscountPercent}%)`;
  }

  // 2. Authoritative Voucher Code calculation
  const rawCode = (opts?.voucherCode ?? "").trim().toUpperCase();
  let voucherId: string | null = null;
  let appliedVoucherCode: string | null = null;
  let voucherDiscount = 0;
  let voucherValid = false;
  let voucherMessage: string | null = null;

  if (rawCode) {
    const voucher = await getVoucherByCode(rawCode);
    if (!voucher) {
      voucherMessage = `Kode voucher "${rawCode}" tidak ditemukan.`;
    } else if (!voucher.isActive) {
      voucherMessage = `Voucher "${voucher.code}" sedang tidak aktif.`;
    } else if (
      voucher.expiresAt &&
      !Number.isNaN(new Date(voucher.expiresAt).getTime()) &&
      Date.now() > new Date(voucher.expiresAt).getTime()
    ) {
      voucherMessage = `Voucher "${voucher.code}" sudah kedaluwarsa.`;
    } else if (
      voucher.usageLimit !== null &&
      voucher.usedCount >= voucher.usageLimit
    ) {
      voucherMessage = `Kuota penggunaan voucher "${voucher.code}" sudah habis.`;
    } else if (memberDiscount > 0 && !settings.newMemberDiscountStackable) {
      voucherMessage =
        "Voucher tidak dapat digabung dengan diskon member yang sedang aktif.";
    } else {
      const eligibleVoucherSubtotal = Math.round(
        itemProducts.reduce((sum, entry) => {
          if (
            productMatchesPromoScope(entry.product, voucher.scope, voucher.tags)
          ) {
            return sum + entry.item.price * entry.item.quantity;
          }
          return sum;
        }, 0)
      );

      if (eligibleVoucherSubtotal <= 0) {
        voucherMessage = `Voucher "${voucher.code}" hanya berlaku untuk produk bertag: ${voucher.tags.join(", ")}.`;
      } else if (eligibleVoucherSubtotal < voucher.minSubtotal) {
        voucherMessage = `Minimum belanja produk eligible untuk "${voucher.code}" adalah Rp ${voucher.minSubtotal.toLocaleString("id-ID")}.`;
      } else {
        if (voucher.discountType === "percent") {
          const pctVal = Math.max(0, Math.min(100, voucher.discountValue));
          let calc = Math.round(eligibleVoucherSubtotal * (pctVal / 100));
          if (voucher.maxDiscount !== null && voucher.maxDiscount > 0) {
            calc = Math.min(calc, voucher.maxDiscount);
          }
          voucherDiscount = calc;
        } else {
          voucherDiscount = Math.min(
            voucher.discountValue,
            eligibleVoucherSubtotal
          );
        }

        if (voucherDiscount > 0) {
          voucherId = voucher.id;
          appliedVoucherCode = voucher.code;
          voucherValid = true;
          voucherMessage =
            voucher.description ||
            (voucher.discountType === "percent"
              ? `Diskon ${voucher.discountValue}% berhasil diterapkan.`
              : `Potongan Rp ${voucherDiscount.toLocaleString("id-ID")} berhasil diterapkan.`);
        } else {
          voucherMessage = `Voucher "${voucher.code}" tidak menghasilkan potongan pada pesanan ini.`;
        }
      }
    }

    if (opts?.requireValidVoucher && !voucherValid) {
      throw new Error(voucherMessage || "Kode voucher tidak valid.");
    }
  }

  // Clamp combined discount safely so total never drops below 0
  const maxAllowedDiscount = Math.max(0, subtotal - 1000);
  let discountTotal = memberDiscount + voucherDiscount;
  if (discountTotal > maxAllowedDiscount) {
    discountTotal = maxAllowedDiscount;
    voucherDiscount = Math.max(0, discountTotal - memberDiscount);
    if (memberDiscount > discountTotal) {
      memberDiscount = discountTotal;
      voucherDiscount = 0;
    }
  }

  const discountedSubtotal = Math.max(0, subtotal - discountTotal);
  const shippingFee =
    discountedSubtotal >= settings.freeShippingThreshold
      ? 0
      : settings.standardShippingFee;
  const total = discountedSubtotal + shippingFee;

  const pricing: CheckoutPricingQuote = {
    subtotal,
    eligibleMemberSubtotal,
    memberDiscount,
    memberDiscountPercent: memberPromoActive
      ? settings.newMemberDiscountPercent
      : 0,
    memberDiscountScope: settings.newMemberDiscountScope,
    memberDiscountTags: settings.newMemberDiscountTags,
    memberEligible,
    memberLabel,
    voucherCode: appliedVoucherCode,
    voucherDiscount,
    voucherValid,
    voucherMessage,
    discountTotal,
    shippingFee,
    total,
    itemCount,
  };

  return {
    id,
    verifiedItems,
    subtotal,
    shippingFee,
    total,
    itemCount,
    settings,
    memberId: member?.id ?? null,
    voucherId,
    voucherCode: appliedVoucherCode,
    voucherDiscount,
    memberDiscount,
    discountTotal,
    pricing,
  };
}

export async function createOrderWithPayment(opts: {
  quote: PreparedOrderQuote;
  customer: CheckoutCustomer;
  paymentMethodLabel: string;
  payment: CreatePaymentRecordInput;
}): Promise<{ order: StoreOrder; payment: PaymentTransaction }> {
  const now = Date.now();
  const { quote, customer, paymentMethodLabel, payment } = opts;
  const { id: paymentId, params: paymentParams } = buildPaymentInsertParams(
    { ...payment, orderId: quote.id },
    now
  );

  const stmts: Stmt[] = [
    {
      sql: `INSERT INTO orders (
        id, items_json, customer_name, customer_email, customer_phone,
        shipping_address, shipping_city, notes, subtotal, shipping_fee,
        total, item_count, payment_method, status, created_at,
        member_id, voucher_code, voucher_discount, member_discount, discount_total
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        quote.id,
        JSON.stringify(quote.verifiedItems),
        customer.name.trim(),
        customer.email.trim().toLowerCase(),
        customer.phone.trim(),
        customer.address.trim(),
        customer.city.trim(),
        customer.notes?.trim() || "",
        quote.subtotal,
        quote.shippingFee,
        quote.total,
        quote.itemCount,
        paymentMethodLabel,
        "pending",
        now,
        quote.memberId,
        quote.voucherCode,
        quote.voucherDiscount,
        quote.memberDiscount,
        quote.discountTotal,
      ],
    },
    {
      sql: PAYMENT_TX_INSERT_SQL,
      params: paymentParams,
    },
  ];

  if (quote.voucherId) {
    stmts.push({
      sql: "UPDATE vouchers SET used_count = used_count + 1, updated_at = ? WHERE id = ?",
      params: [now, quote.voucherId],
    });
  }

  if (quote.memberId) {
    stmts.push({
      sql: `UPDATE members SET
        bag_json = '[]',
        phone = CASE WHEN phone = '' THEN ? ELSE phone END,
        default_address = CASE WHEN default_address = '' THEN ? ELSE default_address END,
        default_city = CASE WHEN default_city = '' THEN ? ELSE default_city END,
        updated_at = ?
      WHERE id = ?`,
      params: [
        customer.phone.trim(),
        customer.address.trim(),
        customer.city.trim(),
        now,
        quote.memberId,
      ],
    });
  }

  await batch(stmts);

  const savedOrder = (await getOrderById(quote.id))!;
  const savedPayment =
    savedOrder.payment ??
    (await first<PaymentTransactionRow>(
      "SELECT * FROM payment_transactions WHERE id = ?",
      [paymentId]
    ).then((r) => (r ? rowToPaymentTransaction(r) : null)))!;

  return { order: savedOrder, payment: savedPayment };
}

export async function attachPaymentToExistingOrder(opts: {
  orderId: string;
  paymentMethodLabel: string;
  payment: CreatePaymentRecordInput;
}): Promise<{ order: StoreOrder; payment: PaymentTransaction }> {
  const now = Date.now();
  const { params: paymentParams } = buildPaymentInsertParams(
    { ...opts.payment, orderId: opts.orderId },
    now
  );

  await batch([
    {
      sql: "UPDATE payment_transactions SET status = 'cancelled', updated_at = ? WHERE order_id = ? AND status = 'pending'",
      params: [now, opts.orderId],
    },
    {
      sql: "UPDATE orders SET payment_method = ?, status = CASE WHEN status = 'cancelled' THEN 'pending' ELSE status END WHERE id = ?",
      params: [opts.paymentMethodLabel, opts.orderId],
    },
    {
      sql: PAYMENT_TX_INSERT_SQL,
      params: paymentParams,
    },
  ]);

  const savedOrder = (await getOrderById(opts.orderId))!;
  return { order: savedOrder, payment: savedOrder.payment! };
}

export async function reconcilePaymentStatus(opts: {
  paymentId: string;
  orderId: string;
  status: PaymentTransactionStatus;
  referenceNo?: string | null;
  paidAt?: string | null;
  issuerName?: string | null;
  feeAmount?: number | null;
  callbackPayload?: unknown;
}): Promise<{ order: StoreOrder | null; payment: PaymentTransaction | null }> {
  const now = Date.now();
  const stmts: Stmt[] = [
    {
      sql: `UPDATE payment_transactions SET
        status = ?,
        reference_no = COALESCE(?, reference_no),
        paid_at = COALESCE(?, paid_at),
        issuer_name = COALESCE(?, issuer_name),
        fee_amount = COALESCE(?, fee_amount),
        callback_payload_json = COALESCE(?, callback_payload_json),
        updated_at = ?
      WHERE id = ?`,
      params: [
        opts.status,
        opts.referenceNo ?? null,
        opts.paidAt ?? null,
        opts.issuerName ?? null,
        opts.feeAmount !== undefined && opts.feeAmount !== null
          ? Math.round(opts.feeAmount)
          : null,
        opts.callbackPayload ? JSON.stringify(opts.callbackPayload) : null,
        now,
        opts.paymentId,
      ],
    },
  ];

  // Promote pending/cancelled order to confirmed once payment is verified paid;
  // NEVER downgrade an already shipped order back to confirmed!
  if (opts.status === "paid") {
    stmts.push({
      sql: "UPDATE orders SET status = 'confirmed' WHERE id = ? AND status IN ('pending', 'cancelled')",
      params: [opts.orderId],
    });
  }

  await batch(stmts);
  const order = await getOrderById(opts.orderId);
  return { order, payment: order?.payment ?? null };
}

export async function cancelOrderPaymentLocally(opts: {
  orderId: string;
  paymentId: string;
  cancelOrder: boolean;
}): Promise<{ order: StoreOrder | null; payment: PaymentTransaction | null }> {
  const now = Date.now();
  const stmts: Stmt[] = [
    {
      sql: "UPDATE payment_transactions SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending'",
      params: [now, opts.paymentId],
    },
  ];
  if (opts.cancelOrder) {
    stmts.push({
      sql: "UPDATE orders SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
      params: [opts.orderId],
    });
  }
  await batch(stmts);
  const order = await getOrderById(opts.orderId);
  return { order, payment: order?.payment ?? null };
}

export async function hasProcessedWebhookExternalId(
  externalId: string
): Promise<boolean> {
  if (!externalId.trim()) return false;
  const row = await first<WebhookLogRow>(
    "SELECT id, external_id, event_type, trx_id, partner_id, signature_valid, http_status, response_code FROM payment_webhook_logs WHERE external_id = ? AND signature_valid = 1 AND http_status = 200 LIMIT 1",
    [externalId.trim()]
  );
  return Boolean(row);
}

export async function recordWebhookLog(opts: {
  externalId?: string | null;
  eventType: string;
  trxId?: string | null;
  partnerId?: string | null;
  signatureValid: boolean;
  httpStatus: number;
  responseCode?: string | null;
  rawHeaders: Record<string, string>;
  rawBody: string;
}): Promise<void> {
  const now = Date.now();
  const extId = opts.externalId?.trim() || null;
  try {
    await run(
      `INSERT INTO payment_webhook_logs (
        external_id, event_type, trx_id, partner_id, signature_valid,
        http_status, response_code, raw_headers_json, raw_body, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(external_id) DO UPDATE SET
        signature_valid = CASE WHEN payment_webhook_logs.signature_valid = 1 THEN 1 ELSE excluded.signature_valid END,
        http_status = excluded.http_status,
        response_code = excluded.response_code`,
      [
        extId,
        opts.eventType,
        opts.trxId ?? null,
        opts.partnerId ?? null,
        opts.signatureValid ? 1 : 0,
        opts.httpStatus,
        opts.responseCode ?? null,
        JSON.stringify(opts.rawHeaders),
        opts.rawBody.slice(0, 16000),
        now,
      ]
    );
  } catch (err) {
    console.error("Failed to record webhook audit log:", err);
  }
}

export async function createOrder(
  rawItems: BagItem[],
  customer?: CheckoutCustomer,
  member?: MemberProfile | null
): Promise<StoreOrder> {
  const quote = await prepareOrderQuote(rawItems, { member: member ?? null });
  const createdAt = Date.now();
  const paymentMethod = "Manual Confirmation (Pay on Delivery / Bank Transfer)";

  await run(
    `INSERT INTO orders (
      id, items_json, customer_name, customer_email, customer_phone,
      shipping_address, shipping_city, notes, subtotal, shipping_fee,
      total, item_count, payment_method, status, created_at,
      member_id, voucher_code, voucher_discount, member_discount, discount_total
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      quote.id,
      JSON.stringify(quote.verifiedItems),
      customer?.name?.trim() || "",
      customer?.email?.trim().toLowerCase() || "",
      customer?.phone?.trim() || "",
      customer?.address?.trim() || "",
      customer?.city?.trim() || "",
      customer?.notes?.trim() || "",
      quote.subtotal,
      quote.shippingFee,
      quote.total,
      quote.itemCount,
      paymentMethod,
      "pending",
      createdAt,
      quote.memberId,
      quote.voucherCode,
      quote.voucherDiscount,
      quote.memberDiscount,
      quote.discountTotal,
    ]
  );

  return (await getOrderById(quote.id))!;
}

export interface UpdateOrderFulfillmentInput {
  status?: OrderStatus;
  isShipped?: boolean;
  isCompleted?: boolean;
  shippingCourier?: string;
  trackingNumber?: string;
}

export async function updateOrderFulfillment(
  id: string,
  input: UpdateOrderFulfillmentInput
): Promise<StoreOrder | null> {
  const existing = await getOrderById(id);
  if (!existing) return null;

  const now = Date.now();
  const preShipStatus: OrderStatus =
    existing.payment && existing.payment.status !== "paid"
      ? "pending"
      : "confirmed";

  let nextStatus: OrderStatus = existing.status;
  let nextShippedAt: number | null = existing.shippedAt ?? null;
  let nextCompletedAt: number | null = existing.completedAt ?? null;

  const nextCourier =
    input.shippingCourier !== undefined
      ? input.shippingCourier.trim().slice(0, 80)
      : existing.shippingCourier ?? "";
  const nextTracking =
    input.trackingNumber !== undefined
      ? input.trackingNumber.trim().slice(0, 120)
      : existing.trackingNumber ?? "";

  if (input.status !== undefined) {
    nextStatus = input.status;
    if (nextStatus === "completed") {
      nextShippedAt = existing.shippedAt ?? now;
      nextCompletedAt = existing.completedAt ?? now;
    } else if (nextStatus === "shipped") {
      nextShippedAt = existing.shippedAt ?? now;
      nextCompletedAt = null;
    } else {
      nextShippedAt = null;
      nextCompletedAt = null;
    }
  } else {
    if (input.isShipped !== undefined) {
      if (input.isShipped) {
        if (nextStatus !== "completed") {
          nextStatus = "shipped";
        }
        nextShippedAt = existing.shippedAt ?? now;
      } else {
        nextStatus = preShipStatus;
        nextShippedAt = null;
        nextCompletedAt = null;
      }
    }

    if (input.isCompleted !== undefined) {
      if (input.isCompleted) {
        nextStatus = "completed";
        nextShippedAt = nextShippedAt ?? now;
        nextCompletedAt = existing.completedAt ?? now;
      } else {
        if (nextStatus === "completed") {
          nextStatus = "shipped";
          nextShippedAt = nextShippedAt ?? now;
        }
        nextCompletedAt = null;
      }
    }
  }

  const res = await run(
    `UPDATE orders SET
      status = ?,
      shipping_courier = ?,
      tracking_number = ?,
      shipped_at = ?,
      completed_at = ?
    WHERE id = ?`,
    [
      nextStatus,
      nextCourier,
      nextTracking,
      nextShippedAt,
      nextCompletedAt,
      existing.id,
    ]
  );
  if (res.changes === 0) return null;
  return getOrderById(existing.id);
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus
): Promise<StoreOrder | null> {
  return updateOrderFulfillment(id, { status });
}

export async function deleteOrder(id: string): Promise<boolean> {
  await batch([
    { sql: "DELETE FROM payment_transactions WHERE order_id = ?", params: [id] },
  ]);
  const res = await run("DELETE FROM orders WHERE id = ?", [id]);
  return res.changes > 0;
}

export async function listNewsletterSubscribers(): Promise<NewsletterSubscriber[]> {
  const rows = await all<SubscriberRow>(
    "SELECT id, email, created_at FROM newsletter_subscribers ORDER BY created_at DESC"
  );
  return rows.map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at }));
}

export async function addNewsletterSubscriber(email: string): Promise<{
  subscriber: NewsletterSubscriber;
  alreadySubscribed: boolean;
}> {
  const normalized = email.trim().toLowerCase();
  const existing = await first<SubscriberRow>(
    "SELECT id, email, created_at FROM newsletter_subscribers WHERE email = ?",
    [normalized]
  );
  if (existing) {
    return {
      subscriber: {
        id: existing.id,
        email: existing.email,
        createdAt: existing.created_at,
      },
      alreadySubscribed: true,
    };
  }
  const now = Date.now();
  const res = await run(
    "INSERT INTO newsletter_subscribers (email, created_at) VALUES (?, ?)",
    [normalized, now]
  );
  return {
    subscriber: { id: res.lastRowId, email: normalized, createdAt: now },
    alreadySubscribed: false,
  };
}

export async function deleteNewsletterSubscriber(id: number): Promise<boolean> {
  const res = await run("DELETE FROM newsletter_subscribers WHERE id = ?", [id]);
  return res.changes > 0;
}

function reconcileSessionWithCatalog(
  catalog: CatalogProduct[],
  rawBag: BagItem[],
  rawWishlist: string[]
): ShoppingSessionData {
  const catalogById = new Map(catalog.map((p) => [p.id, p]));

  const bagItems: BagItem[] = [];
  for (const item of rawBag) {
    if (!item || typeof item.productId !== "string") continue;
    const prod = catalogById.get(item.productId);
    if (!prod) continue;
    const qty = Math.max(1, Math.min(20, Math.round(Number(item.quantity) || 1)));
    const size =
      item.size && prod.sizes.includes(item.size)
        ? item.size
        : prod.selectedSize || prod.sizes[0] || "L";
    bagItems.push({
      key: `${prod.id}:${size}:${prod.title}`,
      productId: prod.id,
      title: prod.title,
      brand: prod.brand,
      category: prod.category,
      colorTag: prod.colorTag,
      size,
      price: prod.price,
      quantity: qty,
      thumbnailUrl: prod.mapping.frontImageUrl || item.thumbnailUrl || "",
    });
  }

  const wishlistIds = Array.from(
    new Set(rawWishlist.filter((id) => typeof id === "string" && catalogById.has(id)))
  );

  return { bagItems, wishlistIds };
}

export async function getShoppingSession(
  sessionId: string,
  catalog?: CatalogProduct[]
): Promise<ShoppingSessionData> {
  if (!sessionId) return { bagItems: [], wishlistIds: [] };
  const [row, products] = await Promise.all([
    first<SessionRow>("SELECT * FROM shopping_sessions WHERE id = ?", [sessionId]),
    catalog ? Promise.resolve(catalog) : listProducts(),
  ]);
  if (!row) return { bagItems: [], wishlistIds: [] };

  let rawBag: BagItem[] = [];
  let rawWishlist: string[] = [];
  try {
    const parsedBag = JSON.parse(row.bag_json);
    if (Array.isArray(parsedBag)) rawBag = parsedBag as BagItem[];
  } catch {
    // ignore
  }
  try {
    const parsedWl = JSON.parse(row.wishlist_json);
    if (Array.isArray(parsedWl)) rawWishlist = parsedWl.map(String);
  } catch {
    // ignore
  }

  return reconcileSessionWithCatalog(products, rawBag, rawWishlist);
}

export async function saveShoppingSession(
  sessionId: string,
  bagItems: BagItem[],
  wishlistIds: string[]
): Promise<ShoppingSessionData> {
  const reconciled = reconcileSessionWithCatalog(
    await listProducts(),
    bagItems,
    wishlistIds
  );
  await run(
    `INSERT INTO shopping_sessions (id, bag_json, wishlist_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bag_json = excluded.bag_json,
      wishlist_json = excluded.wishlist_json,
      updated_at = excluded.updated_at`,
    [
      sessionId,
      JSON.stringify(reconciled.bagItems),
      JSON.stringify(reconciled.wishlistIds),
      Date.now(),
    ]
  );
  return reconciled;
}

export async function getStorefrontData(
  sessionId?: string,
  memberSessionToken?: string
): Promise<StorefrontBootstrap> {
  const [products, rawSlides, settings] = await Promise.all([
    listProducts(),
    listHeroSlides(),
    getStoreSettings(),
  ]);
  const productIds = new Set(products.map((p) => p.id));
  const validSlides = rawSlides.filter((s) => productIds.has(s.productId));

  const memberCtx = memberSessionToken
    ? await getMemberContextBySessionToken(memberSessionToken, products, settings)
    : null;

  if (memberCtx) {
    return {
      products,
      heroSlides: validSlides,
      settings,
      initialBag: memberCtx.bagItems,
      initialWishlistIds: memberCtx.wishlistIds,
      initialMember: memberCtx.member,
    };
  }

  const session = sessionId
    ? await getShoppingSession(sessionId, products)
    : { bagItems: [], wishlistIds: [] };
  return {
    products,
    heroSlides: validSlides,
    settings,
    initialBag: session.bagItems,
    initialWishlistIds: session.wishlistIds,
    initialMember: null,
  };
}

// ---------- Vouchers CRUD ----------

interface VoucherRow {
  id: string;
  code: string;
  description: string;
  discount_type: string;
  discount_value: number;
  max_discount: number | null;
  min_subtotal: number;
  scope: string;
  tags_json: string;
  usage_limit: number | null;
  used_count: number;
  is_active: number;
  expires_at: string | null;
  created_at: number;
  updated_at: number;
}

function rowToVoucher(row: VoucherRow): Voucher {
  let tags: string[] = [];
  try {
    tags = normalizeProductTags(JSON.parse(row.tags_json || "[]"));
  } catch {
    tags = [];
  }
  return {
    id: row.id,
    code: row.code,
    description: row.description || "",
    discountType: row.discount_type === "fixed" ? "fixed" : "percent",
    discountValue: Number(row.discount_value) || 0,
    maxDiscount:
      row.max_discount !== null && row.max_discount !== undefined
        ? Number(row.max_discount)
        : null,
    minSubtotal: Number(row.min_subtotal) || 0,
    scope: row.scope === "tags" ? "tags" : "global",
    tags,
    usageLimit:
      row.usage_limit !== null && row.usage_limit !== undefined
        ? Number(row.usage_limit)
        : null,
    usedCount: Number(row.used_count) || 0,
    isActive: row.is_active === 1,
    expiresAt: row.expires_at ?? null,
    createdAt: Number(row.created_at) || 0,
    updatedAt: Number(row.updated_at) || 0,
  };
}

export async function listVouchers(): Promise<Voucher[]> {
  const rows = await all<VoucherRow>(
    "SELECT * FROM vouchers ORDER BY created_at DESC"
  );
  return rows.map(rowToVoucher);
}

export async function getVoucherById(id: string): Promise<Voucher | null> {
  const row = await first<VoucherRow>("SELECT * FROM vouchers WHERE id = ?", [
    id,
  ]);
  return row ? rowToVoucher(row) : null;
}

export async function getVoucherByCode(code: string): Promise<Voucher | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const row = await first<VoucherRow>(
    "SELECT * FROM vouchers WHERE UPPER(code) = ? LIMIT 1",
    [normalized]
  );
  return row ? rowToVoucher(row) : null;
}

export interface VoucherWriteInput {
  code: string;
  description?: string;
  discountType: VoucherDiscountType;
  discountValue: number;
  maxDiscount?: number | null;
  minSubtotal?: number;
  scope?: PromoScope;
  tags?: string[];
  usageLimit?: number | null;
  isActive?: boolean;
  expiresAt?: string | null;
}

export async function createVoucher(input: VoucherWriteInput): Promise<Voucher> {
  const code = input.code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
  if (code.length < 3 || code.length > 32) {
    throw new Error("Kode voucher harus 3-32 karakter (huruf, angka, _ atau -).");
  }
  const existing = await getVoucherByCode(code);
  if (existing) {
    throw new Error(`Kode voucher "${code}" sudah terdaftar.`);
  }
  const discountType: VoucherDiscountType =
    input.discountType === "fixed" ? "fixed" : "percent";
  const discountValue = Math.round(Number(input.discountValue) || 0);
  if (discountType === "percent" && (discountValue < 1 || discountValue > 95)) {
    throw new Error("Potongan persentase harus antara 1% sampai 95%.");
  }
  if (discountType === "fixed" && discountValue < 1000) {
    throw new Error("Potongan nominal tetap minimal Rp 1.000.");
  }

  const scope: PromoScope = input.scope === "tags" ? "tags" : "global";
  const tags = scope === "tags" ? normalizeProductTags(input.tags ?? []) : [];
  if (scope === "tags" && tags.length === 0) {
    throw new Error("Tambahkan minimal 1 tag produk untuk voucher bertag.");
  }

  const id = `vch-${crypto.randomBytes(5).toString("hex")}`;
  const now = Date.now();
  const maxDiscount =
    discountType === "percent" &&
    input.maxDiscount !== undefined &&
    input.maxDiscount !== null &&
    Number(input.maxDiscount) > 0
      ? Math.round(Number(input.maxDiscount))
      : null;
  const minSubtotal = Math.max(0, Math.round(Number(input.minSubtotal) || 0));
  const usageLimit =
    input.usageLimit !== undefined &&
    input.usageLimit !== null &&
    Number(input.usageLimit) > 0
      ? Math.round(Number(input.usageLimit))
      : null;
  const expiresAt = input.expiresAt?.trim() ? input.expiresAt.trim() : null;

  await run(
    `INSERT INTO vouchers (
      id, code, description, discount_type, discount_value, max_discount,
      min_subtotal, scope, tags_json, usage_limit, used_count, is_active,
      expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      code,
      (input.description || "").trim(),
      discountType,
      discountValue,
      maxDiscount,
      minSubtotal,
      scope,
      JSON.stringify(tags),
      usageLimit,
      0,
      input.isActive === false ? 0 : 1,
      expiresAt,
      now,
      now,
    ]
  );

  return (await getVoucherById(id))!;
}

export async function updateVoucher(
  id: string,
  patch: Partial<VoucherWriteInput>
): Promise<Voucher | null> {
  const existing = await getVoucherById(id);
  if (!existing) return null;

  const nextCode =
    patch.code !== undefined
      ? patch.code
          .trim()
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, "")
      : existing.code;
  if (nextCode.length < 3 || nextCode.length > 32) {
    throw new Error("Kode voucher harus 3-32 karakter (huruf, angka, _ atau -).");
  }
  if (nextCode !== existing.code) {
    const dup = await getVoucherByCode(nextCode);
    if (dup && dup.id !== id) {
      throw new Error(`Kode voucher "${nextCode}" sudah terdaftar.`);
    }
  }

  const nextType: VoucherDiscountType =
    patch.discountType !== undefined
      ? patch.discountType === "fixed"
        ? "fixed"
        : "percent"
      : existing.discountType;
  const nextValue =
    patch.discountValue !== undefined
      ? Math.round(Number(patch.discountValue) || 0)
      : existing.discountValue;
  if (nextType === "percent" && (nextValue < 1 || nextValue > 95)) {
    throw new Error("Potongan persentase harus antara 1% sampai 95%.");
  }
  if (nextType === "fixed" && nextValue < 1000) {
    throw new Error("Potongan nominal tetap minimal Rp 1.000.");
  }

  const nextScope: PromoScope =
    patch.scope !== undefined
      ? patch.scope === "tags"
        ? "tags"
        : "global"
      : existing.scope;
  const nextTags =
    nextScope === "tags"
      ? normalizeProductTags(
          patch.tags !== undefined ? patch.tags : existing.tags
        )
      : [];
  if (nextScope === "tags" && nextTags.length === 0) {
    throw new Error("Tambahkan minimal 1 tag produk untuk voucher bertag.");
  }

  const nextMaxDiscount =
    nextType === "fixed"
      ? null
      : patch.maxDiscount !== undefined
      ? patch.maxDiscount !== null && Number(patch.maxDiscount) > 0
        ? Math.round(Number(patch.maxDiscount))
        : null
      : existing.maxDiscount;
  const nextMinSubtotal =
    patch.minSubtotal !== undefined
      ? Math.max(0, Math.round(Number(patch.minSubtotal) || 0))
      : existing.minSubtotal;
  const nextUsageLimit =
    patch.usageLimit !== undefined
      ? patch.usageLimit !== null && Number(patch.usageLimit) > 0
        ? Math.round(Number(patch.usageLimit))
        : null
      : existing.usageLimit;
  const nextExpiresAt =
    patch.expiresAt !== undefined
      ? patch.expiresAt?.trim() || null
      : existing.expiresAt;
  const nextActive =
    patch.isActive !== undefined ? patch.isActive : existing.isActive;
  const nextDesc =
    patch.description !== undefined
      ? patch.description.trim()
      : existing.description;

  await run(
    `UPDATE vouchers SET
      code = ?, description = ?, discount_type = ?, discount_value = ?,
      max_discount = ?, min_subtotal = ?, scope = ?, tags_json = ?,
      usage_limit = ?, is_active = ?, expires_at = ?, updated_at = ?
    WHERE id = ?`,
    [
      nextCode,
      nextDesc,
      nextType,
      nextValue,
      nextMaxDiscount,
      nextMinSubtotal,
      nextScope,
      JSON.stringify(nextTags),
      nextUsageLimit,
      nextActive ? 1 : 0,
      nextExpiresAt,
      Date.now(),
      id,
    ]
  );

  return getVoucherById(id);
}

export async function deleteVoucher(id: string): Promise<boolean> {
  const res = await run("DELETE FROM vouchers WHERE id = ?", [id]);
  return res.changes > 0;
}

// ---------- Members, Auth Sessions, Persistent Bag & Order History ----------

interface MemberRow {
  id: string;
  email: string;
  name: string;
  phone: string;
  default_address: string;
  default_city: string;
  password_hash: string;
  bag_json: string;
  wishlist_json: string;
  created_at: number;
  updated_at: number;
}

interface MemberSessionRow {
  token_hash: string;
  member_id: string;
  expires_at: number;
  created_at: number;
}

const MEMBER_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function hashSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function hashMemberPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyMemberPassword(password: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const [, salt, hex] = parts;
  if (!salt || !hex) return false;
  try {
    const derived = crypto.scryptSync(password, salt, 64);
    const expected = Buffer.from(hex, "hex");
    if (derived.length !== expected.length) return false;
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

function mergeBags(primary: BagItem[], secondary: BagItem[]): BagItem[] {
  const map = new Map<string, BagItem>();
  for (const item of primary) {
    if (!item || !item.productId) continue;
    const key = `${item.productId}:${item.size}`;
    map.set(key, { ...item });
  }
  for (const item of secondary) {
    if (!item || !item.productId) continue;
    const key = `${item.productId}:${item.size}`;
    const existing = map.get(key);
    if (existing) {
      existing.quantity = Math.min(20, existing.quantity + (item.quantity || 1));
    } else {
      map.set(key, { ...item });
    }
  }
  return Array.from(map.values());
}

function parseMemberBagWishlist(row: MemberRow): ShoppingSessionData {
  let rawBag: BagItem[] = [];
  let rawWishlist: string[] = [];
  try {
    const b = JSON.parse(row.bag_json || "[]");
    if (Array.isArray(b)) rawBag = b as BagItem[];
  } catch {
    rawBag = [];
  }
  try {
    const w = JSON.parse(row.wishlist_json || "[]");
    if (Array.isArray(w)) rawWishlist = w.map(String);
  } catch {
    rawWishlist = [];
  }
  return { bagItems: rawBag, wishlistIds: rawWishlist };
}

async function countActiveMemberOrders(memberId: string): Promise<number> {
  const row = await first<{ c: number }>(
    "SELECT COUNT(*) AS c FROM orders WHERE member_id = ? AND status != 'cancelled'",
    [memberId]
  );
  return Number(row?.c ?? 0);
}

function buildMemberProfile(
  row: MemberRow,
  orderCount: number,
  settings: StoreSettings
): MemberProfile {
  const newMemberEligible =
    settings.newMemberDiscountEnabled &&
    settings.newMemberDiscountPercent > 0 &&
    (settings.newMemberDiscountMaxOrders === 0 ||
      orderCount < settings.newMemberDiscountMaxOrders);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone || "",
    defaultAddress: row.default_address || "",
    defaultCity: row.default_city || "",
    orderCount,
    newMemberEligible,
    createdAt: Number(row.created_at) || 0,
  };
}

async function createMemberSessionToken(memberId: string): Promise<string> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashSessionToken(rawToken);
  const now = Date.now();
  await run(
    "INSERT INTO member_sessions (token_hash, member_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [tokenHash, memberId, now + MEMBER_SESSION_TTL_MS, now]
  );
  return rawToken;
}

export async function registerMember(input: {
  name: string;
  email: string;
  phone?: string;
  password: string;
  guestBag?: BagItem[];
  guestWishlist?: string[];
}): Promise<{
  member: MemberProfile;
  rawToken: string;
  bagItems: BagItem[];
  wishlistIds: string[];
}> {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const phone = (input.phone || "").trim();
  if (name.length < 2) {
    throw new Error("Nama lengkap minimal 2 karakter.");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Masukkan alamat email yang valid.");
  }
  if (!input.password || input.password.length < 6) {
    throw new Error("Password minimal 6 karakter.");
  }

  const existing = await first<MemberRow>(
    "SELECT * FROM members WHERE LOWER(email) = ? LIMIT 1",
    [email]
  );
  if (existing) {
    throw new Error("Email ini sudah terdaftar. Silakan login ke akun Anda.");
  }

  const [catalog, settings] = await Promise.all([
    listProducts(),
    getStoreSettings(),
  ]);
  const reconciled = reconcileSessionWithCatalog(
    catalog,
    input.guestBag ?? [],
    input.guestWishlist ?? []
  );

  const id = `mem-${crypto.randomBytes(6).toString("hex")}`;
  const now = Date.now();
  const passwordHash = hashMemberPassword(input.password);

  await run(
    `INSERT INTO members (
      id, email, name, phone, default_address, default_city, password_hash,
      bag_json, wishlist_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', '', ?, ?, ?, ?, ?)`,
    [
      id,
      email,
      name,
      phone,
      passwordHash,
      JSON.stringify(reconciled.bagItems),
      JSON.stringify(reconciled.wishlistIds),
      now,
      now,
    ]
  );

  const rawToken = await createMemberSessionToken(id);
  const row = (await first<MemberRow>("SELECT * FROM members WHERE id = ?", [
    id,
  ]))!;
  const member = buildMemberProfile(row, 0, settings);

  return {
    member,
    rawToken,
    bagItems: reconciled.bagItems,
    wishlistIds: reconciled.wishlistIds,
  };
}

export async function loginMember(input: {
  email: string;
  password: string;
  guestBag?: BagItem[];
  guestWishlist?: string[];
}): Promise<{
  member: MemberProfile;
  rawToken: string;
  bagItems: BagItem[];
  wishlistIds: string[];
}> {
  const email = input.email.trim().toLowerCase();
  const row = await first<MemberRow>(
    "SELECT * FROM members WHERE LOWER(email) = ? LIMIT 1",
    [email]
  );
  if (!row || !verifyMemberPassword(input.password || "", row.password_hash)) {
    throw new Error("Email atau password salah.");
  }

  const [catalog, settings, orderCount] = await Promise.all([
    listProducts(),
    getStoreSettings(),
    countActiveMemberOrders(row.id),
  ]);

  const saved = parseMemberBagWishlist(row);
  const mergedBag = mergeBags(saved.bagItems, input.guestBag ?? []);
  const mergedWishlist = Array.from(
    new Set([...(input.guestWishlist ?? []), ...saved.wishlistIds])
  );
  const reconciled = reconcileSessionWithCatalog(
    catalog,
    mergedBag,
    mergedWishlist
  );

  await run(
    "UPDATE members SET bag_json = ?, wishlist_json = ?, updated_at = ? WHERE id = ?",
    [
      JSON.stringify(reconciled.bagItems),
      JSON.stringify(reconciled.wishlistIds),
      Date.now(),
      row.id,
    ]
  );

  const rawToken = await createMemberSessionToken(row.id);
  const member = buildMemberProfile(row, orderCount, settings);

  return {
    member,
    rawToken,
    bagItems: reconciled.bagItems,
    wishlistIds: reconciled.wishlistIds,
  };
}

export async function getMemberContextBySessionToken(
  rawToken: string,
  catalogOverride?: CatalogProduct[],
  settingsOverride?: StoreSettings
): Promise<{
  member: MemberProfile;
  bagItems: BagItem[];
  wishlistIds: string[];
} | null> {
  if (!rawToken || rawToken.length < 32) return null;
  const tokenHash = hashSessionToken(rawToken);
  const session = await first<MemberSessionRow>(
    "SELECT * FROM member_sessions WHERE token_hash = ? LIMIT 1",
    [tokenHash]
  );
  if (!session) return null;
  if (Number(session.expires_at) < Date.now()) {
    await run("DELETE FROM member_sessions WHERE token_hash = ?", [tokenHash]);
    return null;
  }

  const row = await first<MemberRow>(
    "SELECT * FROM members WHERE id = ? LIMIT 1",
    [session.member_id]
  );
  if (!row) return null;

  const [catalog, settings, orderCount] = await Promise.all([
    catalogOverride ? Promise.resolve(catalogOverride) : listProducts(),
    settingsOverride ? Promise.resolve(settingsOverride) : getStoreSettings(),
    countActiveMemberOrders(row.id),
  ]);

  const saved = parseMemberBagWishlist(row);
  const reconciled = reconcileSessionWithCatalog(
    catalog,
    saved.bagItems,
    saved.wishlistIds
  );

  return {
    member: buildMemberProfile(row, orderCount, settings),
    bagItems: reconciled.bagItems,
    wishlistIds: reconciled.wishlistIds,
  };
}

export async function logoutMemberSession(rawToken: string): Promise<void> {
  if (!rawToken) return;
  const tokenHash = hashSessionToken(rawToken);
  await run("DELETE FROM member_sessions WHERE token_hash = ?", [tokenHash]);
}

export async function saveMemberBagWishlist(
  memberId: string,
  bagItems: BagItem[],
  wishlistIds: string[]
): Promise<ShoppingSessionData> {
  const reconciled = reconcileSessionWithCatalog(
    await listProducts(),
    bagItems,
    wishlistIds
  );
  await run(
    "UPDATE members SET bag_json = ?, wishlist_json = ?, updated_at = ? WHERE id = ?",
    [
      JSON.stringify(reconciled.bagItems),
      JSON.stringify(reconciled.wishlistIds),
      Date.now(),
      memberId,
    ]
  );
  return reconciled;
}

export async function updateMemberProfile(
  memberId: string,
  patch: {
    name?: string;
    phone?: string;
    defaultAddress?: string;
    defaultCity?: string;
  }
): Promise<MemberProfile | null> {
  const existing = await first<MemberRow>(
    "SELECT * FROM members WHERE id = ? LIMIT 1",
    [memberId]
  );
  if (!existing) return null;

  const nextName =
    patch.name !== undefined && patch.name.trim().length >= 2
      ? patch.name.trim()
      : existing.name;
  const nextPhone =
    patch.phone !== undefined ? patch.phone.trim() : existing.phone;
  const nextAddress =
    patch.defaultAddress !== undefined
      ? patch.defaultAddress.trim()
      : existing.default_address;
  const nextCity =
    patch.defaultCity !== undefined
      ? patch.defaultCity.trim()
      : existing.default_city;

  await run(
    "UPDATE members SET name = ?, phone = ?, default_address = ?, default_city = ?, updated_at = ? WHERE id = ?",
    [nextName, nextPhone, nextAddress, nextCity, Date.now(), memberId]
  );

  const [updated, settings, orderCount] = await Promise.all([
    first<MemberRow>("SELECT * FROM members WHERE id = ?", [memberId]),
    getStoreSettings(),
    countActiveMemberOrders(memberId),
  ]);
  return updated ? buildMemberProfile(updated, orderCount, settings) : null;
}

export async function listMemberOrders(
  memberId: string,
  memberEmail: string
): Promise<StoreOrder[]> {
  const [orderRows, paymentRows] = await Promise.all([
    all<OrderRow>(
      "SELECT * FROM orders WHERE member_id = ? OR LOWER(customer_email) = ? ORDER BY created_at DESC",
      [memberId, memberEmail.trim().toLowerCase()]
    ),
    all<PaymentTransactionRow>(
      "SELECT * FROM payment_transactions ORDER BY created_at DESC"
    ),
  ]);

  const latestPaymentByOrder = new Map<string, PaymentTransaction>();
  for (const pRow of paymentRows) {
    if (!latestPaymentByOrder.has(pRow.order_id)) {
      latestPaymentByOrder.set(pRow.order_id, rowToPaymentTransaction(pRow));
    }
  }

  return orderRows.map((row) => ({
    ...rowToOrder(row),
    payment: latestPaymentByOrder.get(row.id) ?? null,
  }));
}
