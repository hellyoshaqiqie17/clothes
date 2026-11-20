import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_STORE_SETTINGS,
  SEED_CATALOG_PRODUCTS,
  SEED_HERO_SLIDES,
} from "@/data/catalogProducts";
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
  PresetFabricKind,
  ProductBadge,
  ProductCategory,
  ShoppingSessionData,
  StoreOrder,
  StoreSettings,
  StorefrontBootstrap,
} from "@/types/catalog";

// Vercel serverless has a read-only project dir; only /tmp is writable (and ephemeral).
const DATA_DIR = process.env.VERCEL
  ? path.join("/tmp", "meridian-data")
  : path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "meridian.db");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const SCHEMA_VERSION = 2;

declare global {
  var __meridianSqliteDb: DatabaseSync | undefined;
  var __meridianSchemaVersion: number | undefined;
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

interface TableColumnInfo {
  name: string;
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

function ensureOrderColumns(db: DatabaseSync) {
  const cols = db
    .prepare("PRAGMA table_info(orders)")
    .all() as unknown as TableColumnInfo[];
  const existing = new Set(cols.map((c) => c.name));

  const migrations: [string, string][] = [
    ["customer_name", "TEXT NOT NULL DEFAULT ''"],
    ["customer_email", "TEXT NOT NULL DEFAULT ''"],
    ["customer_phone", "TEXT NOT NULL DEFAULT ''"],
    ["shipping_address", "TEXT NOT NULL DEFAULT ''"],
    ["shipping_city", "TEXT NOT NULL DEFAULT ''"],
    ["notes", "TEXT NOT NULL DEFAULT ''"],
    ["shipping_fee", "INTEGER NOT NULL DEFAULT 0"],
    ["total", "INTEGER NOT NULL DEFAULT 0"],
    [
      "payment_method",
      "TEXT NOT NULL DEFAULT 'Manual Confirmation (Pay on Delivery / Transfer)'",
    ],
  ];

  for (const [colName, colDef] of migrations) {
    if (!existing.has(colName)) {
      db.exec(`ALTER TABLE orders ADD COLUMN ${colName} ${colDef};`);
    }
  }
}

function initSchema(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      brand TEXT NOT NULL,
      season TEXT NOT NULL DEFAULT 'SS27',
      category TEXT NOT NULL,
      cut TEXT NOT NULL,
      collection TEXT NOT NULL DEFAULT 'new-arrivals',
      badge TEXT,
      color_tag TEXT NOT NULL,
      price INTEGER NOT NULL,
      compare_at_price INTEGER,
      stock_status TEXT NOT NULL DEFAULT 'In Stock',
      description TEXT NOT NULL,
      sizes_json TEXT NOT NULL,
      selected_size TEXT NOT NULL,
      preset_kind TEXT NOT NULL DEFAULT 'custom',
      mapping_json TEXT NOT NULL,
      is_featured INTEGER NOT NULL DEFAULT 0,
      is_user_published INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hero_slides (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      headline_start TEXT NOT NULL,
      headline_italic TEXT NOT NULL,
      headline_end TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      cta_label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS store_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      items_json TEXT NOT NULL,
      customer_name TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      customer_phone TEXT NOT NULL DEFAULT '',
      shipping_address TEXT NOT NULL DEFAULT '',
      shipping_city TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      subtotal INTEGER NOT NULL,
      shipping_fee INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      item_count INTEGER NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'Manual Confirmation (Pay on Delivery / Transfer)',
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shopping_sessions (
      id TEXT PRIMARY KEY,
      bag_json TEXT NOT NULL DEFAULT '[]',
      wishlist_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
  `);

  ensureOrderColumns(db);
}

function seedDefaultsIfEmpty(db: DatabaseSync) {
  const countRow = db
    .prepare("SELECT COUNT(*) as cnt FROM products")
    .get() as { cnt: number };

  if (countRow.cnt === 0) {
    const insertProduct = db.prepare(`
      INSERT INTO products (
        id, title, brand, season, category, cut, collection, badge, color_tag,
        price, compare_at_price, stock_status, description, sizes_json,
        selected_size, preset_kind, mapping_json, is_featured,
        is_user_published, sort_order, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Date.now();
    for (const p of SEED_CATALOG_PRODUCTS) {
      insertProduct.run(
        p.id,
        p.title,
        p.brand,
        p.season,
        p.category,
        p.cut,
        p.collection,
        p.badge ?? null,
        p.colorTag,
        Math.round(p.price),
        p.compareAtPrice ? Math.round(p.compareAtPrice) : null,
        p.stockStatus,
        p.description,
        JSON.stringify(p.sizes),
        p.selectedSize,
        p.presetKind,
        JSON.stringify(p.mapping),
        p.isFeatured ? 1 : 0,
        p.isUserPublished ? 1 : 0,
        p.sortOrder ?? 0,
        p.createdAt,
        now
      );
    }
  }

  const slideCount = db
    .prepare("SELECT COUNT(*) as cnt FROM hero_slides")
    .get() as { cnt: number };
  if (slideCount.cnt === 0) {
    const insertSlide = db.prepare(`
      INSERT OR IGNORE INTO hero_slides (
        id, product_id, headline_start, headline_italic, headline_end,
        subtitle, cta_label, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const s of SEED_HERO_SLIDES) {
      insertSlide.run(
        s.id,
        s.productId,
        s.headlineStart,
        s.headlineItalic,
        s.headlineEnd,
        s.subtitle,
        s.ctaLabel,
        s.sortOrder
      );
    }
  }

  const insertSetting = db.prepare(
    "INSERT OR IGNORE INTO store_settings (key, value) VALUES (?, ?)"
  );
  insertSetting.run("announcementText", DEFAULT_STORE_SETTINGS.announcementText);
  insertSetting.run(
    "freeShippingThreshold",
    String(DEFAULT_STORE_SETTINGS.freeShippingThreshold)
  );
  insertSetting.run(
    "standardShippingFee",
    String(DEFAULT_STORE_SETTINGS.standardShippingFee)
  );
  insertSetting.run("storeName", DEFAULT_STORE_SETTINGS.storeName);
  insertSetting.run("storeTagline", DEFAULT_STORE_SETTINGS.storeTagline);
  insertSetting.run("storeLocation", DEFAULT_STORE_SETTINGS.storeLocation);
  insertSetting.run("supportEmail", DEFAULT_STORE_SETTINGS.supportEmail);
  insertSetting.run(
    "exchangePolicyDays",
    String(DEFAULT_STORE_SETTINGS.exchangePolicyDays)
  );
}

export function getDb(): DatabaseSync {
  if (!globalThis.__meridianSqliteDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    globalThis.__meridianSqliteDb = new DatabaseSync(DB_PATH);
  }
  if (globalThis.__meridianSchemaVersion !== SCHEMA_VERSION) {
    initSchema(globalThis.__meridianSqliteDb);
    seedDefaultsIfEmpty(globalThis.__meridianSqliteDb);
    globalThis.__meridianSchemaVersion = SCHEMA_VERSION;
  }
  return globalThis.__meridianSqliteDb;
}

export function listProducts(): CatalogProduct[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM products ORDER BY created_at DESC, sort_order ASC")
    .all() as unknown as ProductRow[];
  return rows.map(rowToProduct);
}

export function getProductById(id: string): CatalogProduct | null {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM products WHERE id = ?")
    .get(id) as unknown as ProductRow | undefined;
  return row ? rowToProduct(row) : null;
}

export function createProduct(
  input: Omit<CatalogProduct, "id" | "createdAt"> & { id?: string }
): CatalogProduct {
  const db = getDb();
  const now = Date.now();
  const id = input.id?.trim() || `prod-${crypto.randomBytes(4).toString("hex")}`;

  db.prepare(`
    INSERT INTO products (
      id, title, brand, season, category, cut, collection, badge, color_tag,
      price, compare_at_price, stock_status, description, sizes_json,
      selected_size, preset_kind, mapping_json, is_featured,
      is_user_published, sort_order, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
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
    now
  );

  return getProductById(id)!;
}

export function updateProduct(
  id: string,
  patch: Partial<Omit<CatalogProduct, "badge" | "compareAtPrice">> & {
    badge?: ProductBadge | null;
    compareAtPrice?: number | null;
  }
): CatalogProduct | null {
  const existing = getProductById(id);
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

  const db = getDb();
  db.prepare(`
    UPDATE products SET
      title = ?,
      brand = ?,
      season = ?,
      category = ?,
      cut = ?,
      collection = ?,
      badge = ?,
      color_tag = ?,
      price = ?,
      compare_at_price = ?,
      stock_status = ?,
      description = ?,
      sizes_json = ?,
      selected_size = ?,
      preset_kind = ?,
      mapping_json = ?,
      is_featured = ?,
      is_user_published = ?,
      sort_order = ?,
      updated_at = ?
    WHERE id = ?
  `).run(
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
    id
  );

  return getProductById(id);
}

export function deleteProduct(id: string): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM products WHERE id = ?").run(id);
  return Number(res.changes) > 0;
}

export function listHeroSlides(): HeroSlide[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM hero_slides ORDER BY sort_order ASC")
    .all() as unknown as HeroSlideRow[];
  return rows.map(rowToHeroSlide);
}

export function replaceHeroSlides(slides: HeroSlide[]): HeroSlide[] {
  const db = getDb();
  const existingIds = new Set(listProducts().map((p) => p.id));
  const validSlides = slides.filter((s) => existingIds.has(s.productId));
  if (validSlides.length === 0) {
    throw new Error("Hero slides must reference at least one existing product.");
  }

  db.exec("BEGIN");
  try {
    db.prepare("DELETE FROM hero_slides").run();
    const insert = db.prepare(`
      INSERT INTO hero_slides (
        id, product_id, headline_start, headline_italic, headline_end,
        subtitle, cta_label, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    validSlides.forEach((s, index) => {
      insert.run(
        s.id || `slide-${crypto.randomBytes(3).toString("hex")}`,
        s.productId,
        s.headlineStart,
        s.headlineItalic,
        s.headlineEnd,
        s.subtitle,
        s.ctaLabel,
        index + 1
      );
    });
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return listHeroSlides();
}

export function getStoreSettings(): StoreSettings {
  const db = getDb();
  const rows = db
    .prepare("SELECT key, value FROM store_settings")
    .all() as unknown as SettingRow[];
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

export function updateStoreSettings(patch: Partial<StoreSettings>): StoreSettings {
  const db = getDb();
  const upsert = db.prepare(
    "INSERT INTO store_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  if (patch.announcementText !== undefined) {
    upsert.run("announcementText", patch.announcementText.trim());
  }
  if (
    patch.freeShippingThreshold !== undefined &&
    Number.isFinite(patch.freeShippingThreshold) &&
    patch.freeShippingThreshold >= 0
  ) {
    upsert.run(
      "freeShippingThreshold",
      String(Math.round(patch.freeShippingThreshold))
    );
  }
  if (
    patch.standardShippingFee !== undefined &&
    Number.isFinite(patch.standardShippingFee) &&
    patch.standardShippingFee >= 0
  ) {
    upsert.run(
      "standardShippingFee",
      String(Math.round(patch.standardShippingFee))
    );
  }
  if (patch.storeName !== undefined) {
    upsert.run("storeName", patch.storeName.trim() || "Meridian");
  }
  if (patch.storeTagline !== undefined) {
    upsert.run("storeTagline", patch.storeTagline.trim());
  }
  if (patch.storeLocation !== undefined) {
    upsert.run(
      "storeLocation",
      patch.storeLocation.trim() || DEFAULT_STORE_SETTINGS.storeLocation
    );
  }
  if (patch.supportEmail !== undefined) {
    upsert.run(
      "supportEmail",
      patch.supportEmail.trim() || DEFAULT_STORE_SETTINGS.supportEmail
    );
  }
  if (
    patch.exchangePolicyDays !== undefined &&
    Number.isFinite(patch.exchangePolicyDays) &&
    patch.exchangePolicyDays >= 1
  ) {
    upsert.run(
      "exchangePolicyDays",
      String(Math.min(90, Math.round(patch.exchangePolicyDays)))
    );
  }
  return getStoreSettings();
}

export function listOrders(): StoreOrder[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM orders ORDER BY created_at DESC")
    .all() as unknown as OrderRow[];
  return rows.map(rowToOrder);
}

export function getOrderById(id: string): StoreOrder | null {
  const db = getDb();
  const normalized = id.trim().toUpperCase();
  if (!normalized) return null;
  const row = db
    .prepare("SELECT * FROM orders WHERE UPPER(id) = ?")
    .get(normalized) as unknown as OrderRow | undefined;
  return row ? rowToOrder(row) : null;
}

export function createOrder(
  rawItems: BagItem[],
  customer?: CheckoutCustomer
): StoreOrder {
  const db = getDb();
  const catalogById = new Map(listProducts().map((p) => [p.id, p]));
  const settings = getStoreSettings();

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
  const createdAt = Date.now();
  const paymentMethod = "Manual Confirmation (Pay on Delivery / Bank Transfer)";

  const customerName = customer?.name?.trim() || "";
  const customerEmail = customer?.email?.trim().toLowerCase() || "";
  const customerPhone = customer?.phone?.trim() || "";
  const shippingAddress = customer?.address?.trim() || "";
  const shippingCity = customer?.city?.trim() || "";
  const notes = customer?.notes?.trim() || "";

  db.prepare(`
    INSERT INTO orders (
      id, items_json, customer_name, customer_email, customer_phone,
      shipping_address, shipping_city, notes, subtotal, shipping_fee,
      total, item_count, payment_method, status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    JSON.stringify(verifiedItems),
    customerName,
    customerEmail,
    customerPhone,
    shippingAddress,
    shippingCity,
    notes,
    subtotal,
    shippingFee,
    total,
    itemCount,
    paymentMethod,
    "pending",
    createdAt
  );

  return getOrderById(id)!;
}

export function updateOrderStatus(
  id: string,
  status: OrderStatus
): StoreOrder | null {
  const db = getDb();
  const res = db
    .prepare("UPDATE orders SET status = ? WHERE id = ?")
    .run(status, id);
  if (Number(res.changes) === 0) return null;
  return getOrderById(id);
}

export function deleteOrder(id: string): boolean {
  const db = getDb();
  const res = db.prepare("DELETE FROM orders WHERE id = ?").run(id);
  return Number(res.changes) > 0;
}

export function listNewsletterSubscribers(): NewsletterSubscriber[] {
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, email, created_at FROM newsletter_subscribers ORDER BY created_at DESC"
    )
    .all() as unknown as SubscriberRow[];
  return rows.map((r) => ({ id: r.id, email: r.email, createdAt: r.created_at }));
}

export function addNewsletterSubscriber(email: string): {
  subscriber: NewsletterSubscriber;
  alreadySubscribed: boolean;
} {
  const db = getDb();
  const normalized = email.trim().toLowerCase();
  const existing = db
    .prepare(
      "SELECT id, email, created_at FROM newsletter_subscribers WHERE email = ?"
    )
    .get(normalized) as unknown as SubscriberRow | undefined;
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
  const res = db
    .prepare("INSERT INTO newsletter_subscribers (email, created_at) VALUES (?, ?)")
    .run(normalized, now);
  return {
    subscriber: {
      id: Number(res.lastInsertRowid),
      email: normalized,
      createdAt: now,
    },
    alreadySubscribed: false,
  };
}

export function deleteNewsletterSubscriber(id: number): boolean {
  const db = getDb();
  const res = db
    .prepare("DELETE FROM newsletter_subscribers WHERE id = ?")
    .run(id);
  return Number(res.changes) > 0;
}

function reconcileSessionWithCatalog(
  rawBag: BagItem[],
  rawWishlist: string[]
): ShoppingSessionData {
  const catalogById = new Map(listProducts().map((p) => [p.id, p]));

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

export function getShoppingSession(sessionId: string): ShoppingSessionData {
  if (!sessionId) return { bagItems: [], wishlistIds: [] };
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM shopping_sessions WHERE id = ?")
    .get(sessionId) as unknown as SessionRow | undefined;
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

  return reconcileSessionWithCatalog(rawBag, rawWishlist);
}

export function saveShoppingSession(
  sessionId: string,
  bagItems: BagItem[],
  wishlistIds: string[]
): ShoppingSessionData {
  const db = getDb();
  const reconciled = reconcileSessionWithCatalog(bagItems, wishlistIds);
  const now = Date.now();
  db.prepare(`
    INSERT INTO shopping_sessions (id, bag_json, wishlist_json, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      bag_json = excluded.bag_json,
      wishlist_json = excluded.wishlist_json,
      updated_at = excluded.updated_at
  `).run(
    sessionId,
    JSON.stringify(reconciled.bagItems),
    JSON.stringify(reconciled.wishlistIds),
    now
  );
  return reconciled;
}

export function getStorefrontData(sessionId?: string): StorefrontBootstrap {
  const products = listProducts();
  const rawSlides = listHeroSlides();
  const productIds = new Set(products.map((p) => p.id));
  const validSlides = rawSlides.filter((s) => productIds.has(s.productId));
  const settings = getStoreSettings();
  const session = sessionId
    ? getShoppingSession(sessionId)
    : { bagItems: [], wishlistIds: [] };
  return {
    products,
    heroSlides: validSlides,
    settings,
    initialBag: session.bagItems,
    initialWishlistIds: session.wishlistIds,
  };
}
