# Cloudflare D1 & R2 Object Storage Architecture for Meridian

This document outlines the separation between **Structured Database (Cloudflare D1)** and **Unstructured Object Storage (Cloudflare R2)** for the Meridian 3D apparel platform.

---

## 1. Architectural Distinction

| Component | Technology | Purpose | What is Stored |
| :--- | :--- | :--- | :--- |
| **Relational Database** | **Cloudflare D1** (`b4d911c6-16d7-4048-9709-91a447a9c51b`) | Fast, transactional SQL queries with sub-millisecond read latency worldwide. | Structured records: products, prices, cuts, categories, stock, orders, settings, and image URLs. |
| **Object Storage** | **Cloudflare R2 / S3-compatible** | High-throughput asset hosting with **zero egress fees**. | Binary files: garment photos (`.jpg`), 3D models (`.glb`), buyer uploads, and brand assets. |

> **Key Rule:** Binary files (images, GLBs, PDFs) are **never** stored as BLOBs inside D1. D1 only stores the canonical CDN URL pointing to the Object Storage bucket.

---

## 2. Cloudflare D1 Schema & Migration

All database tables and seed data have been generated in:
`data/schema-d1.sql`

Tables migrated:
1. `store_settings`: Store branding, shipping thresholds, exchange policy, QRIS payload.
2. `products`: Apparel catalog with pricing, cuts, sizes, and R2 asset URLs (`mapping_json`).
3. `hero_slides`: Editorial hero banner carousel config.
4. `orders`: Customer orders with shipping addresses and payment statuses.
5. `newsletter_subscribers`: Email subscriber list.
6. `shopping_sessions`: Persistent shopping bag sessions.

### How to Apply Schema to Cloudflare D1

You can execute the migration using Cloudflare Wrangler CLI or directly via the Cloudflare Dashboard:

#### Option A: Via Wrangler CLI
```bash
# Execute migration remotely to your D1 database:
npx wrangler d1 execute meridian-db --remote --file=./data/schema-d1.sql
```

#### Option B: Via Cloudflare Dashboard
1. Open [Cloudflare Dashboard](https://dash.cloudflare.com/) -> **Storage & Databases** -> **D1 SQL Database**.
2. Select database `b4d911c6-16d7-4048-9709-91a447a9c51b`.
3. Go to the **Console** tab, copy the contents of `data/schema-d1.sql`, paste, and click **Execute**.

---

## 3. Object Storage (R2) Integration

When deploying to Cloudflare:
- Static assets remain cached globally at the edge via `/garments/*` and `/models/*`.
- User-generated uploads (via Seller Studio or receipt uploads) are streamed directly to Cloudflare R2:
  ```typescript
  // Example R2 upload handler
  await env.STORAGE.put(`garments/${filename}`, fileBuffer, {
    httpMetadata: { contentType: file.type }
  });
  const publicUrl = `https://assets.meridianstore.com/garments/${filename}`;
  // Save publicUrl to D1 database mapping_json
  ```
