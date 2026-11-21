import crypto from "node:crypto";
import type {
  BinderPayChannelOption,
  BinderPayConfigStatus,
  PaymentChannelCode,
  PaymentMethodType,
  PaymentTransactionStatus,
  VirtualAccountChannel,
} from "@/types/catalog";

/**
 * BinderPay SNAP BI API Client & Webhook Verifier
 * Spec reference: https://binderpay.id/docs
 */

export const BINDERPAY_BASE_URLS = {
  sandbox: "https://api-sandbox.binderpay.id",
  production: "https://api.binderpay.id",
} as const;

export const SNAP_CALLBACK_PATHS = {
  va: "/v1.0/transfer-va/payment",
  qris: "/v1.0/qr/qr-mpm-notify",
  paymentLink: "/v1.0/payment-links/webhook",
} as const;

/**
 * Official BinderPay Public Key PEM published at:
 * https://binderpay.id/docs/binderpay-public.pem
 * Override via BINDERPAY_PUBLIC_KEY env var if rotated or in tests.
 */
export const DEFAULT_BINDERPAY_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIGeMA0GCSqGSIb3DQEBAQUAA4GMADCBiAKBgFrwP/Z0jbvKf3UA+t5fEktQ7GCu
R9mnE1PMhArtYfSFUMXSxPwOARXBASzaDVf8tDReLtvvhFIS34GKERYnT2h7Sn78
dpGqdFMVc/RABtXJTO7fKjV9xD84/JQwCTg8MZOiUtak8ddZiTGFmrGs4hFrQP2P
GM43qkTjMClXhLZ1AgMBAAE=
-----END PUBLIC KEY-----`;

export const BINDERPAY_VA_CHANNELS: readonly VirtualAccountChannel[] = [
  "BCA",
  "MANDIRI",
  "BNI",
  "BRI",
  "PERMATA",
  "BSI",
  "CIMB",
  "MUAMALAT",
  "SINARMAS",
  "BNC",
  "MAYBANK",
] as const;

export const ALL_PAYMENT_CHANNELS: readonly BinderPayChannelOption[] = [
  {
    paymentType: "qris",
    channel: "QRIS",
    label: "QRIS (GoPay, OVO, DANA, ShopeePay, Mobile Banking)",
    shortLabel: "QRIS",
    group: "instant",
    description: "Scan instantly from any Indonesian e-wallet or mobile banking app.",
  },
  {
    paymentType: "va",
    channel: "BCA",
    label: "BCA Virtual Account",
    shortLabel: "BCA VA",
    group: "va",
    description: "m-BCA, myBCA, KlikBCA, or ATM BCA",
  },
  {
    paymentType: "va",
    channel: "MANDIRI",
    label: "Mandiri Virtual Account",
    shortLabel: "Mandiri VA",
    group: "va",
    description: "Livin' by Mandiri or ATM Mandiri",
  },
  {
    paymentType: "va",
    channel: "BNI",
    label: "BNI Virtual Account",
    shortLabel: "BNI VA",
    group: "va",
    description: "wondr / BNI Mobile Banking or ATM BNI",
  },
  {
    paymentType: "va",
    channel: "BRI",
    label: "BRI Virtual Account",
    shortLabel: "BRI VA",
    group: "va",
    description: "BRImo or ATM BRI",
  },
  {
    paymentType: "va",
    channel: "PERMATA",
    label: "Permata Virtual Account",
    shortLabel: "Permata VA",
    group: "va",
    description: "PermataMobile X or ATM Bersama",
  },
  {
    paymentType: "va",
    channel: "BSI",
    label: "BSI Virtual Account",
    shortLabel: "BSI VA",
    group: "va",
    description: "BYOND / BSI Mobile",
  },
  {
    paymentType: "va",
    channel: "CIMB",
    label: "CIMB Niaga Virtual Account",
    shortLabel: "CIMB VA",
    group: "va",
    description: "OCTO Mobile or OCTO Clicks",
  },
  {
    paymentType: "va",
    channel: "MUAMALAT",
    label: "Bank Muamalat Virtual Account",
    shortLabel: "Muamalat VA",
    group: "va",
    description: "Muamalat DIN Mobile Banking",
  },
  {
    paymentType: "va",
    channel: "SINARMAS",
    label: "Bank Sinarmas Virtual Account",
    shortLabel: "Sinarmas VA",
    group: "va",
    description: "SimobiPlus Mobile Banking",
  },
  {
    paymentType: "va",
    channel: "BNC",
    label: "Bank Neo Commerce Virtual Account",
    shortLabel: "BNC VA",
    group: "va",
    description: "neobank App or interbank transfer",
  },
  {
    paymentType: "va",
    channel: "MAYBANK",
    label: "Maybank Virtual Account",
    shortLabel: "Maybank VA",
    group: "va",
    description: "M2U ID App or Maybank ATM",
  },
  {
    paymentType: "payment_link",
    channel: "LINK",
    label: "BinderPay Hosted Checkout",
    shortLabel: "Payment Link",
    group: "hosted",
    description: "Pay on BinderPay's hosted checkout page (choose QRIS or any VA there).",
  },
] as const;

export class BinderPayApiError extends Error {
  readonly status?: number;
  readonly responseCode?: string;
  readonly responseBody?: unknown;

  constructor(
    message: string,
    opts?: { status?: number; responseCode?: string; responseBody?: unknown }
  ) {
    super(message);
    this.name = "BinderPayApiError";
    this.status = opts?.status;
    this.responseCode = opts?.responseCode;
    this.responseBody = opts?.responseBody;
  }
}

export class BinderPayConfigError extends Error {
  readonly missingEnvVars: string[];

  constructor(missingEnvVars: string[]) {
    super(
      `BinderPay belum dikonfigurasi. Lengkapi environment variable: ${missingEnvVars.join(", ")}.`
    );
    this.name = "BinderPayConfigError";
    this.missingEnvVars = missingEnvVars;
  }
}

/**
 * Normalize PEM keys supplied through .env.local or Vercel environment variables.
 * Supports: multiline PEM, literal "\n"-escaped single-line PEM, surrounding quotes, or Base64-encoded PEM.
 */
export function normalizePemKey(raw: string | undefined | null): string {
  if (!raw) return "";
  let cleaned = raw.trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n");
  if (!cleaned.includes("-----BEGIN")) {
    try {
      const decoded = Buffer.from(cleaned, "base64").toString("utf8").trim();
      if (decoded.includes("-----BEGIN")) {
        cleaned = decoded.replace(/\r\n/g, "\n");
      }
    } catch {
      // keep cleaned as-is; crypto validation will report exact format issue
    }
  }
  return cleaned;
}

export function getBinderPayEnv(): "sandbox" | "production" {
  const raw = (process.env.BINDERPAY_ENV || "sandbox").trim().toLowerCase();
  return raw === "production" || raw === "prod" ? "production" : "sandbox";
}

export function getBinderPayBaseUrl(): string {
  const override = process.env.BINDERPAY_BASE_URL?.trim();
  if (override) return override.replace(/\/+$/, "");
  return BINDERPAY_BASE_URLS[getBinderPayEnv()];
}

export function getBinderPayPublicKey(): string {
  const override = normalizePemKey(process.env.BINDERPAY_PUBLIC_KEY);
  return override || DEFAULT_BINDERPAY_PUBLIC_KEY;
}

export function getEnabledPaymentChannels(): BinderPayChannelOption[] {
  const raw = process.env.BINDERPAY_ENABLED_CHANNELS?.trim();
  if (!raw) {
    // Default clean set of widely used Indonesian channels
    const defaults = new Set<string>([
      "QRIS",
      "BCA",
      "MANDIRI",
      "BNI",
      "BRI",
      "PERMATA",
      "BSI",
      "CIMB",
      "LINK",
    ]);
    return ALL_PAYMENT_CHANNELS.filter((c) => defaults.has(c.channel));
  }
  const allow = new Set(
    raw
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean)
  );
  const filtered = ALL_PAYMENT_CHANNELS.filter(
    (c) => allow.has(c.channel) || (c.channel === "LINK" && allow.has("PAYMENT_LINK"))
  );
  return filtered.length > 0 ? filtered : [ALL_PAYMENT_CHANNELS[0]];
}

export function getMissingBinderPayEnvVars(): string[] {
  const missing: string[] = [];
  if (!process.env.BINDERPAY_PARTNER_ID?.trim()) {
    missing.push("BINDERPAY_PARTNER_ID");
  }
  const priv = normalizePemKey(process.env.BINDERPAY_PRIVATE_KEY);
  if (!priv) {
    missing.push("BINDERPAY_PRIVATE_KEY");
  }
  return missing;
}

export function getBinderPayConfigStatus(siteOrigin: string): BinderPayConfigStatus {
  const origin = siteOrigin.replace(/\/+$/, "");
  const env = getBinderPayEnv();
  const baseUrl = getBinderPayBaseUrl();
  const partnerId = process.env.BINDERPAY_PARTNER_ID?.trim() || "";
  const missingEnvVars = getMissingBinderPayEnvVars();
  const partnerIdMasked =
    partnerId.length > 4
      ? `${partnerId.slice(0, 2)}${"*".repeat(Math.max(2, partnerId.length - 4))}${partnerId.slice(-2)}`
      : partnerId
      ? "****"
      : null;

  return {
    configured: missingEnvVars.length === 0,
    env,
    baseUrl,
    partnerIdMasked,
    missingEnvVars,
    channels: getEnabledPaymentChannels(),
    callbackUrls: {
      unified: `${origin}/api/payments/binderpay/callback`,
      va: `${origin}/api/payments/binderpay/callback/va`,
      qris: `${origin}/api/payments/binderpay/callback/qris`,
      paymentLink: `${origin}/api/payments/binderpay/callback/link`,
    },
  };
}

export function resolveSiteOrigin(req?: Request): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  if (req) {
    const proto =
      req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || "https";
    const host =
      req.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ||
      req.headers.get("host")?.trim();
    if (host) return `${proto}://${host}`;
    try {
      return new URL(req.url).origin;
    } catch {
      // fall through
    }
  }
  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`;
  }
  return "http://localhost:3000";
}

/**
 * Format timestamp in SNAP BI Asia/Jakarta (+07:00) ISO8601:
 * Example: "2026-11-21T20:30:00+07:00"
 */
export function formatWibTimestamp(date: Date = new Date()): string {
  const wib = new Date(date.getTime() + 7 * 60 * 60 * 1000);
  const iso = wib.toISOString().replace(/\.\d{3}Z$/, "");
  return `${iso}+07:00`;
}

export function hashSnapBody(rawBody: string): string {
  return crypto.createHash("sha256").update(rawBody, "utf8").digest("hex").toLowerCase();
}

export function buildSnapStringToSign(
  httpMethod: string,
  endpointUrl: string,
  rawBody: string,
  timestamp: string
): string {
  return [
    httpMethod.toUpperCase(),
    endpointUrl,
    hashSnapBody(rawBody),
    timestamp,
  ].join(":");
}

export function signSnapString(stringToSign: string, privateKeyPem: string): string {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(stringToSign, "utf8");
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}

export function verifySnapString(
  stringToSign: string,
  signatureBase64: string,
  publicKeyPem: string
): boolean {
  try {
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(stringToSign, "utf8");
    verifier.end();
    return verifier.verify(publicKeyPem, Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Generates a unique X-EXTERNAL-ID per API call so BinderPay never rejects
 * repeated status inquiries on the same day with 409xx00 ("Cannot use same X-EXTERNAL-ID in same day").
 */
export function generateExternalId(prefix = "bp"): string {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(5).toString("hex")}`;
}

/**
 * Generates a SNAP-compliant merchant trxId / partnerReferenceNo (5-50 chars, [a-zA-Z0-9_-]).
 */
export function generateMerchantTrxId(orderId: string): string {
  const cleanOrder = orderId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 28);
  const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
  const trxId = `${cleanOrder}-${suffix}`;
  return trxId.length >= 5 ? trxId : `ORD-${trxId}`;
}

/**
 * Sanitizes customer name to strictly match BinderPay Create VA rules:
 * Length 5-24 characters, allowed characters: a-z A-Z 0-9 _ - space.
 */
export function sanitizeVaAccountName(customerName: string): string {
  const cleaned = customerName
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned.length >= 5 ? cleaned : `Meridian ${cleaned || "Guest"}`;
  return base.slice(0, 24).trim();
}

export function formatSnapAmount(amountIdr: number): string {
  const safe = Math.max(0, Math.round(amountIdr));
  return safe.toFixed(2);
}

export function parseSnapAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const num = Number.parseFloat(value.replace(/,/g, ""));
    if (Number.isFinite(num)) return Math.round(num);
  }
  return 0;
}

export function isValidPaymentSelection(
  paymentType: string,
  channel: string
): { paymentType: PaymentMethodType; channel: PaymentChannelCode } | null {
  const normType = paymentType.trim().toLowerCase();
  const normChan = channel.trim().toUpperCase();
  const match = ALL_PAYMENT_CHANNELS.find(
    (c) => c.paymentType === normType && c.channel === normChan
  );
  if (!match) return null;
  return { paymentType: match.paymentType, channel: match.channel };
}

export function formatPaymentMethodDisplay(
  paymentType: PaymentMethodType,
  channel: PaymentChannelCode
): string {
  const found = ALL_PAYMENT_CHANNELS.find(
    (c) => c.paymentType === paymentType && c.channel === channel
  );
  if (found) return `BinderPay · ${found.shortLabel}`;
  if (paymentType === "qris") return "BinderPay · QRIS";
  if (paymentType === "payment_link") return "BinderPay · Payment Link";
  return `BinderPay · ${channel} VA`;
}

function getCredentials(): {
  partnerId: string;
  privateKey: string;
  baseUrl: string;
} {
  const missing = getMissingBinderPayEnvVars();
  if (missing.length > 0) {
    throw new BinderPayConfigError(missing);
  }
  const partnerId = process.env.BINDERPAY_PARTNER_ID!.trim();
  const privateKey = normalizePemKey(process.env.BINDERPAY_PRIVATE_KEY);
  try {
    crypto.createPrivateKey(privateKey);
  } catch (err) {
    throw new BinderPayApiError(
      `Format BINDERPAY_PRIVATE_KEY tidak valid (harus RSA PEM): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  return {
    partnerId,
    privateKey,
    baseUrl: getBinderPayBaseUrl(),
  };
}

interface SnapRequestResult<T> {
  data: T;
  externalId: string;
  timestamp: string;
  httpStatus: number;
}

async function snapRequest<T extends Record<string, unknown>>(opts: {
  method: "GET" | "POST" | "DELETE";
  path: string;
  channelId: string;
  body?: Record<string, unknown>;
  externalId?: string;
}): Promise<SnapRequestResult<T>> {
  const { partnerId, privateKey, baseUrl } = getCredentials();
  const timestamp = formatWibTimestamp();
  const externalId = opts.externalId || generateExternalId();
  const rawBody =
    opts.method === "GET" ? "" : JSON.stringify(opts.body ?? {});

  // For SNAP signing, endpointUrl is the path without query string or with exact path
  const signPath = opts.path;
  const stringToSign = buildSnapStringToSign(
    opts.method,
    signPath,
    rawBody,
    timestamp
  );
  const signature = signSnapString(stringToSign, privateKey);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-TIMESTAMP": timestamp,
    "X-SIGNATURE": signature,
    "X-PARTNER-ID": partnerId,
    "X-EXTERNAL-ID": externalId,
    "CHANNEL-ID": opts.channelId,
  };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${opts.path}`, {
      method: opts.method,
      headers,
      body: opts.method === "GET" ? undefined : rawBody,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw new BinderPayApiError(
      `Gagal menghubungi server BinderPay (${baseUrl}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  const rawText = await res.text();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch {
    parsed = null;
  }

  const responseCode =
    parsed && typeof parsed.responseCode === "string"
      ? parsed.responseCode
      : undefined;
  const responseMessage =
    parsed && typeof parsed.responseMessage === "string"
      ? parsed.responseMessage
      : undefined;

  if (!res.ok || (responseCode && !responseCode.startsWith("200"))) {
    throw new BinderPayApiError(
      responseMessage
        ? `BinderPay [${responseCode || res.status}]: ${responseMessage}`
        : `BinderPay API error (HTTP ${res.status})`,
      {
        status: res.status,
        responseCode,
        responseBody: parsed ?? rawText,
      }
    );
  }

  return {
    data: (parsed ?? {}) as T,
    externalId,
    timestamp,
    httpStatus: res.status,
  };
}

// ---------- QRIS MPM API (Services 47, 51, 77) ----------

export interface BinderPayQrisGenerateResult {
  trxId: string;
  externalId: string;
  contractId: string | null;
  qrContent: string;
  qrUrl: string | null;
  amount: number;
  feeAmount: number;
  payableAmount: number;
  expiredAt: string;
  raw: Record<string, unknown>;
}

export async function generateBinderPayQris(params: {
  trxId: string;
  amount: number;
  expiryMinutes?: number;
}): Promise<BinderPayQrisGenerateResult> {
  if (params.amount < 100) {
    throw new BinderPayApiError("Nominal minimum QRIS adalah Rp 100.");
  }
  const expiryMins = Math.max(
    5,
    Math.min(
      1440,
      params.expiryMinutes ??
        (Number(process.env.BINDERPAY_QRIS_EXPIRY_MINUTES) || 30)
    )
  );
  const validityPeriod = formatWibTimestamp(
    new Date(Date.now() + expiryMins * 60 * 1000)
  );

  const payload = {
    partnerReferenceNo: params.trxId,
    amount: {
      value: formatSnapAmount(params.amount),
      currency: "IDR",
    },
    validityPeriod,
    additionalInfo: {
      isStatic: false,
    },
  };

  const { data, externalId } = await snapRequest<Record<string, unknown>>({
    method: "POST",
    path: "/v1.0/qr/qr-mpm-generate",
    channelId: "QRIS",
    body: payload,
  });

  const additionalInfo = (data.additionalInfo ?? {}) as Record<string, unknown>;
  const amountObj = (data.amount ?? {}) as Record<string, unknown>;
  const feeObj = (data.feeAmount ?? {}) as Record<string, unknown>;

  const qrContent = String(data.qrContent ?? "");
  const qrUrl = data.qrUrl ? String(data.qrUrl) : null;
  if (!qrContent && !qrUrl) {
    throw new BinderPayApiError(
      "BinderPay tidak mengembalikan qrContent maupun qrUrl.",
      { responseBody: data }
    );
  }

  const feeAmount = parseSnapAmount(feeObj.value);
  const returnedTotal = parseSnapAmount(amountObj.value);
  const payableAmount = returnedTotal > 0 ? returnedTotal : params.amount;

  return {
    trxId: String(data.partnerReferenceNo || params.trxId),
    externalId,
    contractId: additionalInfo.contractId ? String(additionalInfo.contractId) : null,
    qrContent,
    qrUrl,
    amount: params.amount,
    feeAmount,
    payableAmount,
    expiredAt: String(additionalInfo.expiredAt || validityPeriod),
    raw: data,
  };
}

export interface BinderPayStatusInquiryResult {
  status: PaymentTransactionStatus;
  referenceNo: string | null;
  paidAt: string | null;
  issuerName: string | null;
  feeAmount: number | null;
  paidAmount: number | null;
  raw: Record<string, unknown>;
}

export function mapQrisLatestStatus(code: string | undefined): PaymentTransactionStatus {
  switch (String(code ?? "").trim()) {
    case "00":
      return "paid";
    case "04":
      return "refunded";
    case "05":
      return "cancelled";
    case "06":
      return "failed";
    case "01":
    case "02":
    case "03":
    case "07":
    default:
      return "pending";
  }
}

export async function queryBinderPayQris(params: {
  trxId: string;
  contractId: string;
}): Promise<BinderPayStatusInquiryResult> {
  const { data } = await snapRequest<Record<string, unknown>>({
    method: "POST",
    path: "/v1.0/qr/qr-mpm-query",
    channelId: "QRIS",
    body: {
      originalPartnerReferenceNo: params.trxId,
      serviceCode: "47",
      additionalInfo: {
        contractId: params.contractId,
      },
    },
  });

  const additionalInfo = (data.additionalInfo ?? {}) as Record<string, unknown>;
  const amountObj = (data.amount ?? {}) as Record<string, unknown>;
  const feeObj = (data.feeAmount ?? {}) as Record<string, unknown>;

  return {
    status: mapQrisLatestStatus(
      typeof data.latestTransactionStatus === "string"
        ? data.latestTransactionStatus
        : undefined
    ),
    referenceNo: additionalInfo.rrn
      ? String(additionalInfo.rrn)
      : data.originalReferenceNo
      ? String(data.originalReferenceNo)
      : null,
    paidAt: data.paidTime ? String(data.paidTime) : null,
    issuerName: additionalInfo.issuer
      ? String(additionalInfo.issuer)
      : additionalInfo.brandName
      ? String(additionalInfo.brandName)
      : null,
    feeAmount: feeObj.value !== undefined ? parseSnapAmount(feeObj.value) : null,
    paidAmount: amountObj.value !== undefined ? parseSnapAmount(amountObj.value) : null,
    raw: data,
  };
}

export async function cancelBinderPayQris(params: {
  trxId: string;
  contractId: string;
  reason?: string;
}): Promise<Record<string, unknown>> {
  const { data } = await snapRequest<Record<string, unknown>>({
    method: "POST",
    path: "/v1.0/qr/qr-mpm-cancel",
    channelId: "QRIS",
    body: {
      originalPartnerReferenceNo: params.trxId,
      reason: (params.reason || "Cancelled by customer").slice(0, 100),
      additionalInfo: {
        contractId: params.contractId,
      },
    },
  });
  return data;
}

// ---------- Virtual Account API (Services 27, 26, 30, 31) ----------

export interface BinderPayVaCreateResult {
  trxId: string;
  externalId: string;
  channel: VirtualAccountChannel;
  contractId: string | null;
  partnerServiceId: string | null;
  customerNo: string | null;
  virtualAccountNo: string;
  virtualAccountName: string;
  amount: number;
  feeAmount: number;
  payableAmount: number;
  expiredAt: string;
  raw: Record<string, unknown>;
}

export async function createBinderPayVirtualAccount(params: {
  trxId: string;
  customerName: string;
  amount: number;
  channel: VirtualAccountChannel;
  expiryMinutes?: number;
}): Promise<BinderPayVaCreateResult> {
  if (params.amount < 1000) {
    throw new BinderPayApiError("Nominal minimum Virtual Account adalah Rp 1.000.");
  }
  const expiryMins = Math.max(
    10,
    Math.min(
      60 * 24 * 30,
      params.expiryMinutes ??
        (Number(process.env.BINDERPAY_VA_EXPIRY_MINUTES) || 1440)
    )
  );
  const expiredDate = formatWibTimestamp(
    new Date(Date.now() + expiryMins * 60 * 1000)
  );
  const virtualAccountName = sanitizeVaAccountName(params.customerName);

  const payload = {
    virtualAccountName,
    trxId: params.trxId,
    totalAmount: {
      value: formatSnapAmount(params.amount),
      currency: "IDR",
    },
    virtualAccountTrxType: "C",
    expiredDate,
    additionalInfo: {
      channel: params.channel,
    },
  };

  const { data, externalId } = await snapRequest<Record<string, unknown>>({
    method: "POST",
    path: "/v1.0/transfer-va/create-va",
    channelId: params.channel,
    body: payload,
  });

  const va = (data.virtualAccountData ?? {}) as Record<string, unknown>;
  const additionalInfo = (va.additionalInfo ?? {}) as Record<string, unknown>;
  const totalObj = (va.totalAmount ?? {}) as Record<string, unknown>;
  const feeObj = (va.feeAmount ?? {}) as Record<string, unknown>;

  const virtualAccountNo = String(va.virtualAccountNo ?? "").trim();
  if (!virtualAccountNo) {
    throw new BinderPayApiError(
      "BinderPay tidak mengembalikan virtualAccountNo.",
      { responseBody: data }
    );
  }

  const feeAmount = parseSnapAmount(feeObj.value);
  const returnedTotal = parseSnapAmount(totalObj.value);
  const payableAmount = returnedTotal > 0 ? returnedTotal : params.amount;

  return {
    trxId: String(va.trxId || params.trxId),
    externalId,
    channel: params.channel,
    contractId: additionalInfo.contractId ? String(additionalInfo.contractId) : null,
    partnerServiceId: va.partnerServiceId ? String(va.partnerServiceId) : null,
    customerNo: va.customerNo ? String(va.customerNo) : null,
    virtualAccountNo,
    virtualAccountName: String(va.virtualAccountName || virtualAccountName),
    amount: params.amount,
    feeAmount,
    payableAmount,
    expiredAt: String(va.expiredDate || expiredDate),
    raw: data,
  };
}

export async function queryBinderPayVirtualAccountStatus(params: {
  virtualAccountNo: string;
  trxId: string;
  contractId: string;
  channel: VirtualAccountChannel;
}): Promise<BinderPayStatusInquiryResult> {
  const { data } = await snapRequest<Record<string, unknown>>({
    method: "POST",
    path: "/v1.0/transfer-va/status",
    channelId: params.channel,
    body: {
      virtualAccountNo: params.virtualAccountNo,
      trxId: params.trxId,
      additionalInfo: {
        contractId: params.contractId,
        channel: params.channel,
      },
    },
  });

  const responseCode = String(data.responseCode ?? "");
  // 2002601 = "Success, No Payment Found" -> still pending
  if (responseCode === "2002601") {
    return {
      status: "pending",
      referenceNo: null,
      paidAt: null,
      issuerName: params.channel,
      feeAmount: null,
      paidAmount: null,
      raw: data,
    };
  }

  const va = (data.virtualAccountData ?? {}) as Record<string, unknown>;
  const flag = String(va.paymentFlagStatus ?? "").trim();
  const totalObj = (va.totalAmount ?? {}) as Record<string, unknown>;
  const feeObj = (va.feeAmount ?? {}) as Record<string, unknown>;

  let status: PaymentTransactionStatus = "pending";
  if (flag === "00") status = "paid";
  else if (flag === "05") status = "cancelled";
  else if (flag === "06") status = "failed";

  return {
    status,
    referenceNo: va.referenceNo !== undefined ? String(va.referenceNo) : null,
    paidAt: va.transactionDate ? String(va.transactionDate) : null,
    issuerName: params.channel,
    feeAmount: feeObj.value !== undefined ? parseSnapAmount(feeObj.value) : null,
    paidAmount: totalObj.value !== undefined ? parseSnapAmount(totalObj.value) : null,
    raw: data,
  };
}

export async function deleteBinderPayVirtualAccount(params: {
  trxId: string;
  virtualAccountNo: string;
  contractId: string;
  channel: VirtualAccountChannel;
}): Promise<Record<string, unknown>> {
  const { data } = await snapRequest<Record<string, unknown>>({
    method: "DELETE",
    path: "/v1.0/transfer-va/delete-va",
    channelId: params.channel,
    body: {
      trxId: params.trxId,
      virtualAccountNo: params.virtualAccountNo,
      additionalInfo: {
        channel: params.channel,
        contractId: params.contractId,
      },
    },
  });
  return data;
}

// ---------- Payment Link (Hosted Checkout, Service 60) ----------

export interface BinderPayPaymentLinkCreateResult {
  trxId: string;
  linkId: string;
  externalId: string;
  paymentUrl: string;
  amount: number;
  feeAmount: number;
  payableAmount: number;
  expiredAt: string | null;
  raw: Record<string, unknown>;
}

export async function createBinderPayPaymentLink(params: {
  trxId: string;
  title: string;
  description: string;
  amount: number;
  customer: { name: string; email: string; phone: string };
  enabledChannels?: string[];
  expiryMinutes?: number;
  redirectUrl: string;
  callbackUrl: string;
}): Promise<BinderPayPaymentLinkCreateResult> {
  if (params.amount < 1000) {
    throw new BinderPayApiError("Nominal minimum Payment Link adalah Rp 1.000.");
  }

  const expiryMinutes = Math.max(
    10,
    Math.min(
      60 * 24 * 30,
      params.expiryMinutes ??
        (Number(process.env.BINDERPAY_VA_EXPIRY_MINUTES) || 1440)
    )
  );

  const channels =
    params.enabledChannels && params.enabledChannels.length > 0
      ? params.enabledChannels
      : getEnabledPaymentChannels()
          .filter((c) => c.channel !== "LINK")
          .map((c) => c.channel);

  const payload = {
    external_id: params.trxId,
    title: params.title.slice(0, 120),
    description: params.description.slice(0, 250),
    amount: Math.round(params.amount),
    fee_customer: 0,
    customer: {
      name: params.customer.name,
      email: params.customer.email,
      phone: params.customer.phone,
    },
    enabled_channels: channels,
    expiry_minutes: expiryMinutes,
    redirect_url: params.redirectUrl,
    callback_url: params.callbackUrl,
  };

  const { data, externalId } = await snapRequest<Record<string, unknown>>({
    method: "POST",
    path: "/v1.0/payment-links",
    channelId: "WEB",
    body: payload,
  });

  const linkData = (data.data ?? data) as Record<string, unknown>;
  const linkId = String(linkData.link_id ?? "").trim();
  const paymentUrl = String(linkData.payment_url ?? "").trim();
  if (!linkId || !paymentUrl) {
    throw new BinderPayApiError(
      "BinderPay tidak mengembalikan link_id / payment_url.",
      { responseBody: data }
    );
  }

  const feeAmount = parseSnapAmount(linkData.fee_customer);
  const totalAmount = parseSnapAmount(linkData.total_amount);

  return {
    trxId: String(linkData.external_id || params.trxId),
    linkId,
    externalId,
    paymentUrl,
    amount: params.amount,
    feeAmount,
    payableAmount: totalAmount > 0 ? totalAmount : params.amount + feeAmount,
    expiredAt: linkData.expired_at ? String(linkData.expired_at) : null,
    raw: data,
  };
}

export async function queryBinderPayPaymentLinkStatus(
  linkId: string
): Promise<BinderPayStatusInquiryResult> {
  const { data } = await snapRequest<Record<string, unknown>>({
    method: "GET",
    path: `/v1.0/payment-links/${encodeURIComponent(linkId)}`,
    channelId: "WEB",
  });

  const linkData = (data.data ?? data) as Record<string, unknown>;
  const paymentInfo = (linkData.payment_info ?? {}) as Record<string, unknown>;
  const rawStatus = String(linkData.status ?? "pending").toLowerCase();

  let status: PaymentTransactionStatus = "pending";
  if (rawStatus === "paid" || rawStatus === "success" || rawStatus === "settled") {
    status = "paid";
  } else if (rawStatus === "expired") {
    status = "expired";
  } else if (rawStatus === "cancelled" || rawStatus === "canceled") {
    status = "cancelled";
  } else if (rawStatus === "failed") {
    status = "failed";
  }

  return {
    status,
    referenceNo: paymentInfo.va_number
      ? String(paymentInfo.va_number)
      : linkData.link_id
      ? String(linkData.link_id)
      : null,
    paidAt: linkData.paid_at
      ? String(linkData.paid_at)
      : paymentInfo.paid_at
      ? String(paymentInfo.paid_at)
      : null,
    issuerName: paymentInfo.payment_channel
      ? String(paymentInfo.payment_channel)
      : null,
    feeAmount:
      linkData.fee_customer !== undefined
        ? parseSnapAmount(linkData.fee_customer)
        : null,
    paidAmount:
      linkData.total_amount !== undefined
        ? parseSnapAmount(linkData.total_amount)
        : linkData.amount !== undefined
        ? parseSnapAmount(linkData.amount)
        : null,
    raw: data,
  };
}

export async function cancelBinderPayPaymentLink(
  linkId: string
): Promise<Record<string, unknown>> {
  const { data } = await snapRequest<Record<string, unknown>>({
    method: "POST",
    path: `/v1.0/payment-links/${encodeURIComponent(linkId)}/cancel`,
    channelId: "WEB",
    body: {},
  });
  return data;
}

// ---------- Webhook Callback Verification & Parsing ----------

export type BinderPayCallbackType = "va" | "qris" | "payment_link";

export interface NormalizedBinderPayCallback {
  type: BinderPayCallbackType;
  trxId: string;
  contractId: string | null;
  linkId: string | null;
  status: PaymentTransactionStatus;
  paidAmount: number;
  feeAmount: number;
  referenceNo: string | null;
  paidAt: string | null;
  channel: string | null;
  issuerName: string | null;
  virtualAccountNo: string | null;
  raw: Record<string, unknown>;
}

export interface CallbackVerificationResult {
  valid: boolean;
  reason?: string;
  matchedPath?: string;
  timestamp: string;
  externalId: string;
  partnerId: string;
}

export function verifyBinderPayCallbackHeaders(opts: {
  headers: Headers | Record<string, string | string[] | undefined>;
  rawBody: string;
  publicKeyPem?: string;
  expectedPartnerId?: string;
  requestPathname?: string;
  now?: Date;
}): CallbackVerificationResult {
  const getHeader = (name: string): string => {
    if (opts.headers instanceof Headers) {
      return opts.headers.get(name)?.trim() || "";
    }
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(opts.headers)) {
      if (k.toLowerCase() === lower) {
        return Array.isArray(v) ? (v[0] ?? "").trim() : String(v ?? "").trim();
      }
    }
    return "";
  };

  const signature = getHeader("x-signature");
  const timestamp = getHeader("x-timestamp");
  const externalId = getHeader("x-external-id");
  const partnerId = getHeader("x-partner-id");

  if (!signature || !timestamp) {
    return {
      valid: false,
      reason: "Missing X-SIGNATURE or X-TIMESTAMP header",
      timestamp,
      externalId,
      partnerId,
    };
  }

  const parsedTime = new Date(timestamp).getTime();
  if (Number.isNaN(parsedTime)) {
    return {
      valid: false,
      reason: "Invalid X-TIMESTAMP format",
      timestamp,
      externalId,
      partnerId,
    };
  }

  const nowMs = (opts.now ?? new Date()).getTime();
  const driftSeconds = Math.abs(Math.floor((nowMs - parsedTime) / 1000));
  if (driftSeconds > 300) {
    return {
      valid: false,
      reason: "X-TIMESTAMP outside allowed ±5 minute window",
      timestamp,
      externalId,
      partnerId,
    };
  }

  const configuredPartnerId =
    opts.expectedPartnerId ?? process.env.BINDERPAY_PARTNER_ID?.trim() ?? "";
  if (configuredPartnerId && partnerId && partnerId !== configuredPartnerId) {
    return {
      valid: false,
      reason: "X-PARTNER-ID mismatch",
      timestamp,
      externalId,
      partnerId,
    };
  }

  const pubKey = normalizePemKey(opts.publicKeyPem) || getBinderPayPublicKey();
  const candidatePaths = Array.from(
    new Set(
      [
        SNAP_CALLBACK_PATHS.va,
        SNAP_CALLBACK_PATHS.qris,
        SNAP_CALLBACK_PATHS.paymentLink,
        opts.requestPathname || "",
      ].filter(Boolean)
    )
  );

  for (const path of candidatePaths) {
    const stringToSign = buildSnapStringToSign(
      "POST",
      path,
      opts.rawBody,
      timestamp
    );
    if (verifySnapString(stringToSign, signature, pubKey)) {
      return {
        valid: true,
        matchedPath: path,
        timestamp,
        externalId,
        partnerId,
      };
    }
  }

  return {
    valid: false,
    reason: "Invalid RSA-SHA256 signature",
    timestamp,
    externalId,
    partnerId,
  };
}

export function parseBinderPayCallbackPayload(
  payload: unknown
): NormalizedBinderPayCallback {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Callback payload must be a JSON object.");
  }
  const body = payload as Record<string, unknown>;
  const additionalInfo = (body.additionalInfo ?? {}) as Record<string, unknown>;

  // 1. Payment Link Webhook: has link_id / external_id / event
  if (
    (typeof body.link_id === "string" && body.link_id.trim()) ||
    (typeof body.event === "string" && body.event.startsWith("payment."))
  ) {
    const trxId = String(body.external_id ?? "").trim();
    const linkId = body.link_id ? String(body.link_id).trim() : null;
    if (!trxId && !linkId) {
      throw new Error("Payment link callback missing external_id and link_id.");
    }
    const rawStatus = String(body.status ?? "").toLowerCase();
    let status: PaymentTransactionStatus = "pending";
    if (rawStatus === "paid" || rawStatus === "success" || body.event === "payment.completed") {
      status = "paid";
    } else if (rawStatus === "expired") {
      status = "expired";
    } else if (rawStatus === "cancelled" || rawStatus === "canceled") {
      status = "cancelled";
    } else if (rawStatus === "failed") {
      status = "failed";
    }

    return {
      type: "payment_link",
      trxId,
      contractId: null,
      linkId,
      status,
      paidAmount: parseSnapAmount(body.total_amount ?? body.amount),
      feeAmount: parseSnapAmount(body.fee_customer),
      referenceNo: linkId,
      paidAt: body.paid_at ? String(body.paid_at) : formatWibTimestamp(),
      channel: body.payment_channel ? String(body.payment_channel).toUpperCase() : "LINK",
      issuerName: body.payment_channel ? String(body.payment_channel) : null,
      virtualAccountNo: null,
      raw: body,
    };
  }

  // 2. QRIS Callback: has originalReferenceNo & originalPartnerReferenceNo
  if (body.originalReferenceNo !== undefined && body.originalReferenceNo !== null && String(body.originalReferenceNo).trim() !== "") {
    const trxId = String(body.originalPartnerReferenceNo ?? "").trim();
    if (!trxId) {
      throw new Error("QRIS callback missing originalPartnerReferenceNo.");
    }
    const amountObj = (body.amount ?? {}) as Record<string, unknown>;
    const feeObj = (body.feeAmount ?? {}) as Record<string, unknown>;
    const status = mapQrisLatestStatus(
      body.latestTransactionStatus !== undefined
        ? String(body.latestTransactionStatus)
        : "00"
    );

    return {
      type: "qris",
      trxId,
      contractId: additionalInfo.contractId ? String(additionalInfo.contractId) : null,
      linkId: null,
      status,
      paidAmount: parseSnapAmount(amountObj.value),
      feeAmount: parseSnapAmount(feeObj.value),
      referenceNo: additionalInfo.rrn
        ? String(additionalInfo.rrn)
        : String(body.originalReferenceNo),
      paidAt: body.paidTime ? String(body.paidTime) : formatWibTimestamp(),
      channel: "QRIS",
      issuerName: additionalInfo.brandName
        ? String(additionalInfo.brandName)
        : additionalInfo.issuer
        ? String(additionalInfo.issuer)
        : null,
      virtualAccountNo: null,
      raw: body,
    };
  }

  // 3. Virtual Account Callback: has trxId & virtualAccountNo
  if (body.trxId !== undefined && body.trxId !== null && String(body.trxId).trim() !== "") {
    const trxId = String(body.trxId).trim();
    const paidObj = (body.paidAmount ?? {}) as Record<string, unknown>;
    const feeObj = (body.feeAmount ?? {}) as Record<string, unknown>;

    return {
      type: "va",
      trxId,
      contractId: additionalInfo.contractId ? String(additionalInfo.contractId) : null,
      linkId: null,
      status: "paid",
      paidAmount: parseSnapAmount(paidObj.value),
      feeAmount: parseSnapAmount(feeObj.value),
      referenceNo:
        body.referenceNo !== undefined && body.referenceNo !== null
          ? String(body.referenceNo)
          : body.paymentRequestId
          ? String(body.paymentRequestId)
          : null,
      paidAt: body.trxDateTime ? String(body.trxDateTime) : formatWibTimestamp(),
      channel: additionalInfo.channel
        ? String(additionalInfo.channel).toUpperCase()
        : null,
      issuerName: additionalInfo.channel
        ? String(additionalInfo.channel).toUpperCase()
        : null,
      virtualAccountNo: body.virtualAccountNo ? String(body.virtualAccountNo) : null,
      raw: body,
    };
  }

  throw new Error(
    "Unrecognized BinderPay callback payload (expected VA trxId, QRIS originalReferenceNo, or Payment Link link_id)."
  );
}

export function getBinderPayCallbackSuccessResponse(
  type: BinderPayCallbackType
): { responseCode: string; responseMessage: string } {
  if (type === "qris") {
    return { responseCode: "2005200", responseMessage: "Successful" };
  }
  if (type === "payment_link") {
    return { responseCode: "2006000", responseMessage: "Successful" };
  }
  return { responseCode: "2002500", responseMessage: "Successful" };
}
