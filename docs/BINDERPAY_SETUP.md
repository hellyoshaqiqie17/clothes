# Panduan Setup Payment Gateway BinderPay (SNAP BI)

Integrasi Payment Gateway Meridian menggunakan spesifikasi resmi **BinderPay SNAP BI** (`https://binderpay.id/docs`) dengan RSA-SHA256 Asymmetric Signature, verifikasi callback berbasis Public Key BinderPay, dan persistensi transaksi di Cloudflare D1.

## 1. Generate Pasangan RSA Key (Jika Belum Punya)

Jalankan perintah berikut di terminal (OpenSSL) untuk membuat keypair RSA 2048-bit:

```bash
openssl genrsa -out binderpay-private.pem 2048
openssl rsa -in binderpay-private.pem -pubout -out binderpay-public-merchant.pem
```

- Upload **Public Key** (`binderpay-public-merchant.pem`) ke **Dashboard BinderPay** (menu API / SNAP Keys).
- Simpan **Private Key** (`binderpay-private.pem`) secara aman sebagai environment variable `BINDERPAY_PRIVATE_KEY` (jangan pernah commit file `.pem` ke Git).

## 2. Environment Variables (`.env.local` & Vercel)

Tambahkan variabel berikut di `.env.local` (untuk development lokal) dan di **Vercel → Project Settings → Environment Variables** (untuk produksi):

| Variable | Wajib | Contoh / Keterangan |
|---|---|---|
| `BINDERPAY_ENV` | Ya | `sandbox` untuk uji coba (`api-sandbox.binderpay.id`) atau `production` untuk live (`api.binderpay.id`) |
| `BINDERPAY_PARTNER_ID` | Ya | Partner ID resmi dari Dashboard BinderPay (`X-PARTNER-ID`) |
| `BINDERPAY_PRIVATE_KEY` | Ya | Isi RSA Private Key PEM merchant. Di Vercel, ganti baris baru dengan `\n` atau encode ke Base64 |
| `BINDERPAY_PUBLIC_KEY` | Opsional | Default sudah memakai Public Key resmi BinderPay (`https://binderpay.id/docs/binderpay-public.pem`). Isi hanya jika ada rotasi key |
| `BINDERPAY_ENABLED_CHANNELS` | Opsional | Default: `QRIS,BCA,MANDIRI,BNI,BRI,PERMATA,BSI,CIMB,LINK` |
| `BINDERPAY_QRIS_EXPIRY_MINUTES` | Opsional | Masa berlaku QRIS dinamis dalam menit (default: `30`) |
| `BINDERPAY_VA_EXPIRY_MINUTES` | Opsional | Masa berlaku Virtual Account / Payment Link dalam menit (default: `1440` = 24 jam) |
| `NEXT_PUBLIC_SITE_URL` | Disarankan | URL publik toko, mis. `https://clothes-sc8z-plum.vercel.app` |

## 3. Daftarkan Webhook Callback URL di Dashboard BinderPay

Semua endpoint callback memverifikasi `X-TIMESTAMP` (±5 menit), `X-PARTNER-ID`, dan `X-SIGNATURE` (RSA-SHA256 pada raw body) menggunakan Public Key BinderPay, memproses secara idempotent dengan `X-EXTERNAL-ID`, serta membalas kode SNAP resmi (`2002500` untuk VA, `2005200` untuk QRIS, `2006000` untuk Payment Link).

- **Unified Callback (VA + QRIS + Link):** `https://clothes-sc8z-plum.vercel.app/api/payments/binderpay/callback`
- **Virtual Account Callback:** `https://clothes-sc8z-plum.vercel.app/api/payments/binderpay/callback/va`
- **QRIS Callback:** `https://clothes-sc8z-plum.vercel.app/api/payments/binderpay/callback/qris`
- **Payment Link Webhook:** `https://clothes-sc8z-plum.vercel.app/api/payments/binderpay/callback/link`

URL di atas juga dapat disalin langsung dari halaman **Admin → Store Settings**.

## 4. Ringkasan Endpoint API

| Method & Path | Fungsi |
|---|---|
| `GET /api/payments/binderpay/config` | Status koneksi BinderPay, daftar channel aktif, dan daftar Callback URL (tidak pernah mengekspos secret/private key) |
| `POST /api/payments/binderpay/create` | Membuat order baru + transaksi BinderPay (QRIS / VA / Payment Link), atau mengganti metode bayar pada order yang masih pending |
| `GET /api/payments/binderpay/status?orderId=...` | Inquiry status live ke BinderPay (`Query QRIS` / `Inquiry Status VA` / `Cek Status Link`) dan rekonsiliasi status order di D1 |
| `POST /api/payments/binderpay/cancel` | Membatalkan transaksi pending di BinderPay (`Cancel QRIS` / `Delete VA` / `Cancel Link`) dan memperbarui status di D1 |
| `POST /api/payments/binderpay/callback` | Penerima webhook terverifikasi RSA-SHA256 + idempotent audit log di tabel `payment_webhook_logs` |
