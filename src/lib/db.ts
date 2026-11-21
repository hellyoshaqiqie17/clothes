import crypto from "node:crypto";
import { DEFAULT_STORE_SETTINGS } from "@/data/catalogProducts";
import type {
  BagItem,
  CatalogProduct,
  CheckoutCustomer,
  CollectionTag,
  GarmentCut,
  GarmentMapping,
  HeroSlide,
  NewsletterSubscriber,
  OrderStatus,
  PaymentChannelCode,
  PaymentMethodType,
  PaymentTransaction,
  PaymentTransactionStatus,
  PresetFabricKind,
  ProductBadge,
  ProductCategory,
  ShoppingSessionData,
  StoreOrder,
  StoreSettings,
  StorefrontBootstrap,
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
  };
}
const PRODUCT_COLUMNS = `id, title, brand, season, category, cut, collection, badge, color_tag,
  price, compare_at_price, stock_status, description, sizes_json,
  selected_size, preset_kind, mapping_json, is_featured,
  is_user_published, sort_order, created_at, updated_at`;
const PRODUCT_PLACEHOLDERS = new Array(22).fill("?").join(", ");

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
      updated_at = ?
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
  rawItems: BagItem[]
): Promise<PreparedOrderQuote> {
  const [catalog, settings] = await Promise.all([
    listProducts(),
    getStoreSettings(),
  ]);
  const catalogById = new Map(catalog.map((p) => [p.id, p]));

  const verifiedItems: BagItem[] = [];
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
    verifiedItems.push({
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
    });
  }

  if (verifiedItems.length === 0) {
    throw new Error("Order must include at least one valid catalog item.");
  }

  const id = `ORD-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const subtotal = Math.round(
    verifiedItems.reduce((sum, i) => sum + i.price * i.quantity, 0)
  );
  const shippingFee =
    subtotal >= settings.freeShippingThreshold ? 0 : settings.standardShippingFee;
  const total = subtotal + shippingFee;
  const itemCount = verifiedItems.reduce((sum, i) => sum + i.quantity, 0);

  return { id, verifiedItems, subtotal, shippingFee, total, itemCount, settings };
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

  await batch([
    {
      sql: `INSERT INTO orders (
        id, items_json, customer_name, customer_email, customer_phone,
        shipping_address, shipping_city, notes, subtotal, shipping_fee,
        total, item_count, payment_method, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      ],
    },
    {
      sql: PAYMENT_TX_INSERT_SQL,
      params: paymentParams,
    },
  ]);

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
  customer?: CheckoutCustomer
): Promise<StoreOrder> {
  const quote = await prepareOrderQuote(rawItems);
  const createdAt = Date.now();
  const paymentMethod = "Manual Confirmation (Pay on Delivery / Bank Transfer)";

  await run(
    `INSERT INTO orders (
      id, items_json, customer_name, customer_email, customer_phone,
      shipping_address, shipping_city, notes, subtotal, shipping_fee,
      total, item_count, payment_method, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );

  return (await getOrderById(quote.id))!;
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus
): Promise<StoreOrder | null> {
  const res = await run("UPDATE orders SET status = ? WHERE id = ?", [status, id]);
  if (res.changes === 0) return null;
  return getOrderById(id);
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
  sessionId?: string
): Promise<StorefrontBootstrap> {
  const [products, rawSlides, settings] = await Promise.all([
    listProducts(),
    listHeroSlides(),
    getStoreSettings(),
  ]);
  const productIds = new Set(products.map((p) => p.id));
  const validSlides = rawSlides.filter((s) => productIds.has(s.productId));
  const session = sessionId
    ? await getShoppingSession(sessionId, products)
    : { bagItems: [], wishlistIds: [] };
  return {
    products,
    heroSlides: validSlides,
    settings,
    initialBag: session.bagItems,
    initialWishlistIds: session.wishlistIds,
  };
}
