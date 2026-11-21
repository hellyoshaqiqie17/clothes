-- Meridian Store Database Schema & Initial Data for Cloudflare D1
-- Target Database ID: b4d911c6-16d7-4048-9709-91a447a9c51b

DROP TABLE IF EXISTS store_settings;
CREATE TABLE store_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

DROP TABLE IF EXISTS products;
CREATE TABLE products (
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

DROP TABLE IF EXISTS hero_slides;
CREATE TABLE hero_slides (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      headline_start TEXT NOT NULL,
      headline_italic TEXT NOT NULL,
      headline_end TEXT NOT NULL,
      subtitle TEXT NOT NULL,
      cta_label TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

DROP TABLE IF EXISTS newsletter_subscribers;
CREATE TABLE newsletter_subscribers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      created_at INTEGER NOT NULL
    );

DROP TABLE IF EXISTS orders;
CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      items_json TEXT NOT NULL,
      subtotal INTEGER NOT NULL,
      item_count INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL
    , customer_name TEXT NOT NULL DEFAULT '', customer_email TEXT NOT NULL DEFAULT '', customer_phone TEXT NOT NULL DEFAULT '', shipping_address TEXT NOT NULL DEFAULT '', shipping_city TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '', shipping_fee INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, payment_method TEXT NOT NULL DEFAULT 'Manual Confirmation (Pay on Delivery / Transfer)');

DROP TABLE IF EXISTS shopping_sessions;
CREATE TABLE shopping_sessions (
      id TEXT PRIMARY KEY,
      bag_json TEXT NOT NULL DEFAULT '[]',
      wishlist_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

DROP TABLE IF EXISTS payment_transactions;
CREATE TABLE payment_transactions (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'binderpay',
      payment_type TEXT NOT NULL,
      channel TEXT NOT NULL,
      trx_id TEXT NOT NULL UNIQUE,
      contract_id TEXT,
      link_id TEXT,
      external_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      fee_amount INTEGER NOT NULL DEFAULT 0,
      payable_amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'IDR',
      status TEXT NOT NULL DEFAULT 'pending',
      qr_content TEXT,
      qr_url TEXT,
      virtual_account_no TEXT,
      virtual_account_name TEXT,
      partner_service_id TEXT,
      customer_no TEXT,
      payment_url TEXT,
      reference_no TEXT,
      issuer_name TEXT,
      expired_at TEXT,
      paid_at TEXT,
      raw_response_json TEXT,
      callback_payload_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_payment_tx_order_id ON payment_transactions(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_trx_id ON payment_transactions(trx_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_contract_id ON payment_transactions(contract_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_link_id ON payment_transactions(link_id);

DROP TABLE IF EXISTS payment_webhook_logs;
CREATE TABLE payment_webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT UNIQUE,
      event_type TEXT NOT NULL,
      trx_id TEXT,
      partner_id TEXT,
      signature_valid INTEGER NOT NULL DEFAULT 0,
      http_status INTEGER NOT NULL,
      response_code TEXT,
      raw_headers_json TEXT,
      raw_body TEXT,
      created_at INTEGER NOT NULL
    );
CREATE INDEX IF NOT EXISTS idx_webhook_logs_trx_id ON payment_webhook_logs(trx_id);

-- Seed data for store_settings
INSERT INTO store_settings (key, value) VALUES ('announcementText', 'Free shipping across Indonesia on orders over Rp 1.500.000 · 14-day size exchange');
INSERT INTO store_settings (key, value) VALUES ('freeShippingThreshold', '1500000');
INSERT INTO store_settings (key, value) VALUES ('storeName', 'Meridian');
INSERT INTO store_settings (key, value) VALUES ('storeTagline', 'Everyday ready-to-wear in heavyweight cotton, knitwear, and washed denim. Preview every garment in studio photos or interactive 3D.');
INSERT INTO store_settings (key, value) VALUES ('standardShippingFee', '35000');
INSERT INTO store_settings (key, value) VALUES ('storeLocation', 'Jakarta, Indonesia');
INSERT INTO store_settings (key, value) VALUES ('supportEmail', 'care@meridian.id');
INSERT INTO store_settings (key, value) VALUES ('exchangePolicyDays', '14');

-- Seed data for products
INSERT INTO products (id, title, brand, season, category, cut, collection, badge, color_tag, price, compare_at_price, stock_status, description, sizes_json, selected_size, preset_kind, mapping_json, is_featured, is_user_published, sort_order, created_at, updated_at) VALUES ('prod-01', 'Heavyweight Box Tee', 'MERIDIAN', 'SS27', 'top', 'tee', 'new-arrivals', 'NEW', 'OFF-WHITE COTTON', 420000, NULL, 'In Stock', '280gsm combed cotton short-sleeve box tee with structured shoulder drape, thick ribbed crew collar, and minimalist front & back print.', '["S","M","L","XL"]', 'L', 'graphic-tee', '{"frontImageUrl":"/garments/heavyweight-box-tee-front.jpg","backImageUrl":"/garments/heavyweight-box-tee-back.jpg","sleeveImageUrl":null,"projectionMode":"auto-garment","scale":1,"offsetX":0,"offsetY":0,"backScale":1,"backOffsetY":0,"autoRemoveBackground":true,"baseColorHex":"#DDD9D0","detectedFabricLabel":"FRONT + BACK PRINT"}', 1, 0, 1, 1700000008, 1795112738445);
INSERT INTO products (id, title, brand, season, category, cut, collection, badge, color_tag, price, compare_at_price, stock_status, description, sizes_json, selected_size, preset_kind, mapping_json, is_featured, is_user_published, sort_order, created_at, updated_at) VALUES ('prod-02', 'Ribbed Charcoal Knit Sweater', 'FORM STUDIO', 'SS27', 'top', 'knit', 'best-sellers', 'BEST SELLER', 'CHARCOAL KNIT', 980000, 1150000, 'In Stock', 'Open-gauge ribbed knit crewneck sweater in deep charcoal merino-cotton blend with structured cuffs and relaxed drape.', '["S","M","L","XL"]', 'L', 'charcoal-knit', '{"frontImageUrl":"/garments/ribbed-knit-crewneck-front.jpg","backImageUrl":null,"sleeveImageUrl":null,"projectionMode":"auto-garment","scale":1,"offsetX":0,"offsetY":0,"backScale":1,"backOffsetY":0,"autoRemoveBackground":true,"baseColorHex":"#272A2F","detectedFabricLabel":"AUTO-MATCHED KNIT BACK"}', 1, 0, 2, 1700000007, 1795112738445);
INSERT INTO products (id, title, brand, season, category, cut, collection, badge, color_tag, price, compare_at_price, stock_status, description, sizes_json, selected_size, preset_kind, mapping_json, is_featured, is_user_published, sort_order, created_at, updated_at) VALUES ('prod-03', 'Washed Fleece Crewneck Pullover', 'NOIR STUDIO', 'SS27', 'top', 'hoodie', 'limited', 'LIMITED', 'FADED CHARCOAL', 890000, 1050000, 'Limited Stock', 'Garment-dyed heavyweight cotton fleece pullover featuring mineral-washed seams, tonal chest emblem, and screenprinted back graphic.', '["S","M","L","XL"]', 'L', 'acid-hoodie', '{"frontImageUrl":"/garments/washed-fleece-hoodie-front.jpg","backImageUrl":"/garments/washed-fleece-hoodie-back.jpg","sleeveImageUrl":null,"projectionMode":"auto-garment","scale":1,"offsetX":0,"offsetY":0,"backScale":1,"backOffsetY":0,"autoRemoveBackground":true,"baseColorHex":"#363A40","detectedFabricLabel":"FRONT + BACK PRINT"}', 0, 0, 3, 1700000006, 1795112738445);
INSERT INTO products (id, title, brand, season, category, cut, collection, badge, color_tag, price, compare_at_price, stock_status, description, sizes_json, selected_size, preset_kind, mapping_json, is_featured, is_user_published, sort_order, created_at, updated_at) VALUES ('prod-04', 'Boxy Wool Twill Work Jacket', 'FORM STUDIO', 'SS27', 'top', 'jacket', 'limited', 'LIMITED', 'OBSIDIAN WOOL', 1490000, NULL, 'Limited Stock', 'Structured chore overshirt jacket cut in matte dark wool twill with spread collar, horn buttons, and dual chest patch pockets.', '["S","M","L","XL"]', 'M', 'raw-jacket', '{"frontImageUrl":"/garments/twill-work-jacket-front.jpg","backImageUrl":null,"sleeveImageUrl":null,"projectionMode":"auto-garment","scale":1,"offsetX":0,"offsetY":0,"backScale":1,"backOffsetY":0,"autoRemoveBackground":true,"baseColorHex":"#1E2126","detectedFabricLabel":"AUTO-MATCHED WOOL TWILL"}', 0, 0, 4, 1700000005, 1795112738445);
INSERT INTO products (id, title, brand, season, category, cut, collection, badge, color_tag, price, compare_at_price, stock_status, description, sizes_json, selected_size, preset_kind, mapping_json, is_featured, is_user_published, sort_order, created_at, updated_at) VALUES ('prod-05', 'Light-Wash Baggy Denim', 'RAW DENIM CO.', 'SS27', 'bottom', 'baggy-denim', 'best-sellers', 'BEST SELLER', 'LIGHT WASH', 920000, NULL, 'In Stock', 'Wide-leg loose denim washed to vintage pale indigo with contrast tan topstitching, 5-pocket construction, and natural thigh fade.', '["28","30","32","34"]', '32', 'light-denim', '{"frontImageUrl":"/garments/light-wash-baggy-denim-front.jpg","backImageUrl":null,"sleeveImageUrl":null,"projectionMode":"auto-garment","scale":1,"offsetX":0,"offsetY":0,"backScale":1,"backOffsetY":0,"autoRemoveBackground":true,"baseColorHex":"#7F93A9","detectedFabricLabel":"AUTO-MATCHED WASHED DENIM"}', 1, 0, 5, 1700000004, 1795112738445);
INSERT INTO products (id, title, brand, season, category, cut, collection, badge, color_tag, price, compare_at_price, stock_status, description, sizes_json, selected_size, preset_kind, mapping_json, is_featured, is_user_published, sort_order, created_at, updated_at) VALUES ('prod-06', 'Ripstop Parachute Cargo Pant', 'NOIR STUDIO', 'SS27', 'bottom', 'cargo', 'new-arrivals', 'NEW', 'MATTE BLACK', 875000, NULL, 'In Stock', 'Technical matte black ripstop nylon wide trousers with bellows side thigh pockets and articulated knee pleats.', '["S","M","L","XL"]', 'M', 'parachute-cargo', '{"frontImageUrl":"/garments/tech-parachute-cargo-front.jpg","backImageUrl":null,"sleeveImageUrl":null,"projectionMode":"auto-garment","scale":1,"offsetX":0,"offsetY":0,"backScale":1,"backOffsetY":0,"autoRemoveBackground":true,"baseColorHex":"#1D2025","detectedFabricLabel":"AUTO-MATCHED NYLON RIPSTOP"}', 1, 0, 6, 1700000003, 1795112738445);
INSERT INTO products (id, title, brand, season, category, cut, collection, badge, color_tag, price, compare_at_price, stock_status, description, sizes_json, selected_size, preset_kind, mapping_json, is_featured, is_user_published, sort_order, created_at, updated_at) VALUES ('prod-07', 'Washed Black Straight Denim', 'RAW DENIM CO.', 'SS27', 'bottom', 'trouser', 'best-sellers', NULL, 'WASHED BLACK', 840000, NULL, 'In Stock', 'Mid-rise straight selvedge denim finished in smoked charcoal wash with subtle whiskering and matte pewter hardware.', '["28","30","32","34"]', '30', 'washed-denim', '{"frontImageUrl":"/garments/washed-black-selvedge-front.jpg","backImageUrl":null,"sleeveImageUrl":null,"projectionMode":"auto-garment","scale":1,"offsetX":0,"offsetY":0,"backScale":1,"backOffsetY":0,"autoRemoveBackground":true,"baseColorHex":"#2C3036","detectedFabricLabel":"AUTO-MATCHED CHARCOAL DENIM"}', 0, 0, 7, 1700000002, 1795112738445);
INSERT INTO products (id, title, brand, season, category, cut, collection, badge, color_tag, price, compare_at_price, stock_status, description, sizes_json, selected_size, preset_kind, mapping_json, is_featured, is_user_published, sort_order, created_at, updated_at) VALUES ('prod-08', 'Pleated Olive Utility Shorts', 'MERIDIAN', 'SS27', 'bottom', 'shorts', 'new-arrivals', 'NEW', 'SLATE OLIVE', 560000, NULL, 'In Stock', 'Knee-length wide utility shorts in structured heavy cotton twill with double front pleats and clean slash pockets.', '["S","M","L","XL"]', 'M', 'utility-shorts', '{"frontImageUrl":"/garments/twill-utility-shorts-front.jpg","backImageUrl":null,"sleeveImageUrl":null,"projectionMode":"auto-garment","scale":1,"offsetX":0,"offsetY":0,"backScale":1,"backOffsetY":0,"autoRemoveBackground":true,"baseColorHex":"#4A554E","detectedFabricLabel":"AUTO-MATCHED COTTON TWILL"}', 0, 0, 8, 1700000001, 1795112738445);

-- Seed data for hero_slides
INSERT INTO hero_slides (id, product_id, headline_start, headline_italic, headline_end, subtitle, cta_label, sort_order) VALUES ('slide-01', 'prod-01', 'Everyday garments, ', 'tailored', ' to wear on repeat.', '280gsm combed cotton tees with structured shoulder drape and crisp front & back print. Drag the garment to inspect every angle in 3D before picking your size.', 'Shop Heavyweight Tee', 1);
INSERT INTO hero_slides (id, product_id, headline_start, headline_italic, headline_end, subtitle, cta_label, sort_order) VALUES ('slide-02', 'prod-02', 'Open-gauge charcoal knit, ', 'built', ' for easy layering.', 'Textured ribbed knitwear finished with structured cuffs and a relaxed shoulder drop. Rotate in 3D or inspect studio photos.', 'Shop Knit Sweater', 2);
INSERT INTO hero_slides (id, product_id, headline_start, headline_italic, headline_end, subtitle, cta_label, sort_order) VALUES ('slide-03', 'prod-05', 'Wide-leg washed denim with an ', 'effortless', ' drape.', 'Soft pale indigo denim cut in a full baggy silhouette with contrast topstitching and vintage thigh fade. Inspect from waistband to cuff in 3D.', 'Shop Baggy Denim', 3);

-- Seed data for shopping_sessions
INSERT INTO shopping_sessions (id, bag_json, wishlist_json, updated_at) VALUES ('sid_2f58f67c3916113878731c8c', '[]', '[]', 1795152020538);
INSERT INTO shopping_sessions (id, bag_json, wishlist_json, updated_at) VALUES ('sid_a86c6166d2de6cc4f43e79d1', '[]', '[]', 1795143712213);
INSERT INTO shopping_sessions (id, bag_json, wishlist_json, updated_at) VALUES ('sid_7f4efc53f4ef69d0ff47d618', '[]', '[]', 1795156823870);

