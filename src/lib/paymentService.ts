import { NextResponse } from "next/server";
import {
  BinderPayApiError,
  type BinderPayCallbackType,
  cancelBinderPayPaymentLink,
  cancelBinderPayQris,
  createBinderPayPaymentLink,
  createBinderPayVirtualAccount,
  deleteBinderPayVirtualAccount,
  generateBinderPayQris,
  generateMerchantTrxId,
  getBinderPayCallbackSuccessResponse,
  getMissingBinderPayEnvVars,
  parseBinderPayCallbackPayload,
  queryBinderPayPaymentLinkStatus,
  queryBinderPayQris,
  queryBinderPayVirtualAccountStatus,
  verifyBinderPayCallbackHeaders,
} from "@/lib/binderpay";
import {
  type CreatePaymentRecordInput,
  getOrderById,
  getPaymentByLookup,
  hasProcessedWebhookExternalId,
  reconcilePaymentStatus,
  recordWebhookLog,
} from "@/lib/db";
import type {
  CheckoutCustomer,
  PaymentChannelCode,
  PaymentMethodType,
  PaymentTransaction,
  StoreOrder,
  VirtualAccountChannel,
} from "@/types/catalog";

export interface GatewayPaymentCreation {
  record: CreatePaymentRecordInput;
  rollback: () => Promise<void>;
}

export async function createGatewayPaymentForOrder(opts: {
  orderId: string;
  amount: number;
  itemCount: number;
  itemSummary: string;
  customer: CheckoutCustomer;
  paymentType: PaymentMethodType;
  channel: PaymentChannelCode;
  siteOrigin: string;
}): Promise<GatewayPaymentCreation> {
  const trxId = generateMerchantTrxId(opts.orderId);

  if (opts.paymentType === "qris") {
    const res = await generateBinderPayQris({
      trxId,
      amount: opts.amount,
    });
    return {
      record: {
        orderId: opts.orderId,
        paymentType: "qris",
        channel: "QRIS",
        trxId: res.trxId,
        contractId: res.contractId,
        externalId: res.externalId,
        amount: res.amount,
        feeAmount: res.feeAmount,
        payableAmount: res.payableAmount,
        currency: "IDR",
        status: "pending",
        qrContent: res.qrContent,
        qrUrl: res.qrUrl,
        expiredAt: res.expiredAt,
        rawResponse: res.raw,
      },
      rollback: async () => {
        if (!res.contractId) return;
        try {
          await cancelBinderPayQris({
            trxId: res.trxId,
            contractId: res.contractId,
            reason: "Rollback after order persistence failure",
          });
        } catch {
          // best-effort cleanup
        }
      },
    };
  }

  if (opts.paymentType === "payment_link") {
    const origin = opts.siteOrigin.replace(/\/+$/, "");
    const res = await createBinderPayPaymentLink({
      trxId,
      title: `Meridian Order ${opts.orderId}`,
      description: `${opts.itemCount} item(s): ${opts.itemSummary}`,
      amount: opts.amount,
      customer: {
        name: opts.customer.name.trim(),
        email: opts.customer.email.trim().toLowerCase(),
        phone: opts.customer.phone.trim(),
      },
      redirectUrl: `${origin}/?order=${encodeURIComponent(opts.orderId)}&payment=return`,
      callbackUrl: `${origin}/api/payments/binderpay/callback/link`,
    });
    return {
      record: {
        orderId: opts.orderId,
        paymentType: "payment_link",
        channel: "LINK",
        trxId: res.trxId,
        linkId: res.linkId,
        externalId: res.externalId,
        amount: res.amount,
        feeAmount: res.feeAmount,
        payableAmount: res.payableAmount,
        currency: "IDR",
        status: "pending",
        paymentUrl: res.paymentUrl,
        expiredAt: res.expiredAt,
        rawResponse: res.raw,
      },
      rollback: async () => {
        try {
          await cancelBinderPayPaymentLink(res.linkId);
        } catch {
          // best-effort cleanup
        }
      },
    };
  }

  // Default: Virtual Account (One-Off C)
  const vaChannel = opts.channel as VirtualAccountChannel;
  const res = await createBinderPayVirtualAccount({
    trxId,
    customerName: opts.customer.name,
    amount: opts.amount,
    channel: vaChannel,
  });

  return {
    record: {
      orderId: opts.orderId,
      paymentType: "va",
      channel: res.channel,
      trxId: res.trxId,
      contractId: res.contractId,
      externalId: res.externalId,
      amount: res.amount,
      feeAmount: res.feeAmount,
      payableAmount: res.payableAmount,
      currency: "IDR",
      status: "pending",
      virtualAccountNo: res.virtualAccountNo,
      virtualAccountName: res.virtualAccountName,
      partnerServiceId: res.partnerServiceId,
      customerNo: res.customerNo,
      expiredAt: res.expiredAt,
      rawResponse: res.raw,
    },
    rollback: async () => {
      if (!res.contractId) return;
      try {
        await deleteBinderPayVirtualAccount({
          trxId: res.trxId,
          virtualAccountNo: res.virtualAccountNo,
          contractId: res.contractId,
          channel: res.channel,
        });
      } catch {
        // best-effort cleanup
      }
    },
  };
}

export async function cancelGatewayPaymentBestEffort(
  payment: PaymentTransaction,
  reason = "Cancelled by customer"
): Promise<{ cancelledOnGateway: boolean; gatewayError?: string }> {
  if (payment.status !== "pending") {
    return { cancelledOnGateway: false };
  }
  if (getMissingBinderPayEnvVars().length > 0) {
    return { cancelledOnGateway: false };
  }

  try {
    if (payment.paymentType === "qris" && payment.contractId) {
      await cancelBinderPayQris({
        trxId: payment.trxId,
        contractId: payment.contractId,
        reason,
      });
      return { cancelledOnGateway: true };
    }
    if (
      payment.paymentType === "va" &&
      payment.virtualAccountNo &&
      payment.contractId
    ) {
      await deleteBinderPayVirtualAccount({
        trxId: payment.trxId,
        virtualAccountNo: payment.virtualAccountNo,
        contractId: payment.contractId,
        channel: payment.channel as VirtualAccountChannel,
      });
      return { cancelledOnGateway: true };
    }
    if (payment.paymentType === "payment_link" && payment.linkId) {
      await cancelBinderPayPaymentLink(payment.linkId);
      return { cancelledOnGateway: true };
    }
    return { cancelledOnGateway: false };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to cancel on BinderPay";
    return { cancelledOnGateway: false, gatewayError: message };
  }
}

export async function syncOrderPaymentStatus(orderId: string): Promise<{
  order: StoreOrder | null;
  payment: PaymentTransaction | null;
  syncedFromGateway: boolean;
  gatewayError?: string;
}> {
  const order = await getOrderById(orderId);
  if (!order) {
    return { order: null, payment: null, syncedFromGateway: false };
  }

  const payment = order.payment ?? null;
  if (!payment || payment.status !== "pending") {
    return { order, payment, syncedFromGateway: false };
  }

  let syncedFromGateway = false;
  let gatewayError: string | undefined;

  if (getMissingBinderPayEnvVars().length === 0) {
    try {
      let inquiry = null;
      if (payment.paymentType === "qris" && payment.contractId) {
        inquiry = await queryBinderPayQris({
          trxId: payment.trxId,
          contractId: payment.contractId,
        });
      } else if (
        payment.paymentType === "va" &&
        payment.virtualAccountNo &&
        payment.contractId
      ) {
        inquiry = await queryBinderPayVirtualAccountStatus({
          virtualAccountNo: payment.virtualAccountNo,
          trxId: payment.trxId,
          contractId: payment.contractId,
          channel: payment.channel as VirtualAccountChannel,
        });
      } else if (payment.paymentType === "payment_link" && payment.linkId) {
        inquiry = await queryBinderPayPaymentLinkStatus(payment.linkId);
      }

      if (inquiry) {
        syncedFromGateway = true;
        if (inquiry.status !== "pending") {
          const updated = await reconcilePaymentStatus({
            paymentId: payment.id,
            orderId: order.id,
            status: inquiry.status,
            referenceNo: inquiry.referenceNo,
            paidAt: inquiry.paidAt,
            issuerName: inquiry.issuerName,
            feeAmount: inquiry.feeAmount,
            callbackPayload: inquiry.raw,
          });
          return {
            order: updated.order,
            payment: updated.payment,
            syncedFromGateway: true,
          };
        }
      }
    } catch (err) {
      // BinderPay 4042601 (Transaction not found yet on VA) is normal before payment settles
      if (
        err instanceof BinderPayApiError &&
        err.responseCode === "4042601"
      ) {
        syncedFromGateway = true;
      } else {
        gatewayError =
          err instanceof Error ? err.message : "Gateway status check failed";
      }
    }
  }

  // Local expiry check only after gateway confirmed not paid
  if (payment.expiredAt) {
    const expiryMs = new Date(payment.expiredAt).getTime();
    if (!Number.isNaN(expiryMs) && Date.now() > expiryMs) {
      const expired = await reconcilePaymentStatus({
        paymentId: payment.id,
        orderId: order.id,
        status: "expired",
      });
      return {
        order: expired.order,
        payment: expired.payment,
        syncedFromGateway,
        gatewayError,
      };
    }
  }

  return { order, payment, syncedFromGateway, gatewayError };
}

function collectSafeHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of [
    "x-timestamp",
    "x-signature",
    "x-partner-id",
    "x-external-id",
    "channel-id",
    "content-type",
    "user-agent",
  ]) {
    const val = headers.get(key);
    if (val) result[key] = val;
  }
  return result;
}

function unauthorizedSnapCode(expectedType?: BinderPayCallbackType): string {
  if (expectedType === "qris") return "4015200";
  if (expectedType === "payment_link") return "4016000";
  return "4012500";
}

function notFoundSnapCode(type: BinderPayCallbackType): string {
  if (type === "qris") return "4045201";
  if (type === "payment_link") return "4046016";
  return "4042501";
}

export async function handleBinderPayWebhookRequest(
  req: Request,
  expectedType?: BinderPayCallbackType
): Promise<NextResponse> {
  // CRITICAL: Read untouched raw body BEFORE parsing JSON so SHA256 matches BinderPay's signature byte-for-byte
  const rawBody = await req.text();
  const safeHeaders = collectSafeHeaders(req.headers);

  let pathname = "/api/payments/binderpay/callback";
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    // keep default
  }

  const verification = verifyBinderPayCallbackHeaders({
    headers: req.headers,
    rawBody,
    requestPathname: pathname,
  });

  if (!verification.valid) {
    // For Payment Link webhooks specifically, BinderPay's docs do not guarantee SNAP
    // RSA signature headers. NEVER trust an unsigned webhook body: instead, verify
    // authoritatively via server-to-server GET /v1.0/payment-links/{link_id} directly
    // against BinderPay's API! VA and QRIS callbacks ALWAYS require valid RSA-SHA256.
    let verifiedViaPaymentLinkApi = false;
    if (
      (expectedType === "payment_link" || !expectedType) &&
      getMissingBinderPayEnvVars().length === 0
    ) {
      try {
        const candidate = JSON.parse(rawBody) as Record<string, unknown>;
        const linkId =
          typeof candidate?.link_id === "string" ? candidate.link_id.trim() : "";
        if (linkId) {
          const existingTx = await getPaymentByLookup({ linkId });
          if (existingTx && existingTx.paymentType === "payment_link") {
            const liveCheck = await queryBinderPayPaymentLinkStatus(linkId);
            if (liveCheck.status === "paid" || liveCheck.status === "expired" || liveCheck.status === "cancelled") {
              verifiedViaPaymentLinkApi = true;
              if (existingTx.status !== "paid") {
                await reconcilePaymentStatus({
                  paymentId: existingTx.id,
                  orderId: existingTx.orderId,
                  status: liveCheck.status,
                  referenceNo: liveCheck.referenceNo,
                  paidAt: liveCheck.paidAt,
                  issuerName: liveCheck.issuerName,
                  feeAmount: liveCheck.feeAmount,
                  callbackPayload: liveCheck.raw,
                });
              }
              const ack = getBinderPayCallbackSuccessResponse("payment_link");
              await recordWebhookLog({
                externalId: verification.externalId || `pl-verify-${linkId}-${Date.now()}`,
                eventType: "payment_link",
                trxId: existingTx.trxId,
                partnerId: verification.partnerId || null,
                signatureValid: true,
                httpStatus: 200,
                responseCode: ack.responseCode,
                rawHeaders: safeHeaders,
                rawBody,
              });
              return NextResponse.json(ack, { status: 200 });
            }
          }
        }
      } catch {
        // fall through to 401 unauthorized
      }
    }

    if (!verifiedViaPaymentLinkApi) {
      const code = unauthorizedSnapCode(expectedType);
      await recordWebhookLog({
        externalId: verification.externalId || null,
        eventType: expectedType || "unknown",
        partnerId: verification.partnerId || null,
        signatureValid: false,
        httpStatus: 401,
        responseCode: code,
        rawHeaders: safeHeaders,
        rawBody,
      });
      return NextResponse.json(
        {
          responseCode: code,
          responseMessage: verification.reason || "Invalid signature",
        },
        { status: 401 }
      );
    }
  }

  // Parse JSON payload only AFTER RSA-SHA256 signature verification succeeded
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    await recordWebhookLog({
      externalId: verification.externalId || null,
      eventType: expectedType || "unknown",
      partnerId: verification.partnerId || null,
      signatureValid: true,
      httpStatus: 400,
      responseCode: "4002500",
      rawHeaders: safeHeaders,
      rawBody,
    });
    return NextResponse.json(
      { responseCode: "4002500", responseMessage: "Malformed JSON body" },
      { status: 400 }
    );
  }

  let callback;
  try {
    callback = parseBinderPayCallbackPayload(parsedJson);
  } catch (err) {
    await recordWebhookLog({
      externalId: verification.externalId || null,
      eventType: expectedType || "unknown",
      partnerId: verification.partnerId || null,
      signatureValid: true,
      httpStatus: 400,
      responseCode: "4002501",
      rawHeaders: safeHeaders,
      rawBody,
    });
    return NextResponse.json(
      {
        responseCode: "4002501",
        responseMessage:
          err instanceof Error ? err.message : "Invalid callback payload",
      },
      { status: 400 }
    );
  }

  const ack = getBinderPayCallbackSuccessResponse(callback.type);

  // Strict idempotency check by X-EXTERNAL-ID
  if (
    verification.externalId &&
    (await hasProcessedWebhookExternalId(verification.externalId))
  ) {
    return NextResponse.json(ack, { status: 200 });
  }

  const payment = await getPaymentByLookup({
    trxId: callback.trxId,
    contractId: callback.contractId,
    linkId: callback.linkId,
  });

  if (!payment) {
    const code = notFoundSnapCode(callback.type);
    await recordWebhookLog({
      externalId: verification.externalId || null,
      eventType: callback.type,
      trxId: callback.trxId,
      partnerId: verification.partnerId || null,
      signatureValid: true,
      httpStatus: 404,
      responseCode: code,
      rawHeaders: safeHeaders,
      rawBody,
    });
    return NextResponse.json(
      { responseCode: code, responseMessage: "Transaction not found" },
      { status: 404 }
    );
  }

  // Verify paid amount integrity to prevent underpayment tampering
  if (
    callback.status === "paid" &&
    callback.paidAmount > 0 &&
    callback.paidAmount < payment.amount
  ) {
    await recordWebhookLog({
      externalId: verification.externalId || null,
      eventType: callback.type,
      trxId: callback.trxId,
      partnerId: verification.partnerId || null,
      signatureValid: true,
      httpStatus: 400,
      responseCode: "4002501",
      rawHeaders: safeHeaders,
      rawBody,
    });
    return NextResponse.json(
      {
        responseCode: "4002501",
        responseMessage: "Paid amount is less than order total",
      },
      { status: 400 }
    );
  }

  // Idempotent update: if already paid, do not regress status; still ACK 200
  if (payment.status !== "paid" || callback.status === "refunded") {
    await reconcilePaymentStatus({
      paymentId: payment.id,
      orderId: payment.orderId,
      status: callback.status,
      referenceNo: callback.referenceNo,
      paidAt: callback.paidAt,
      issuerName: callback.issuerName,
      feeAmount: callback.feeAmount > 0 ? callback.feeAmount : null,
      callbackPayload: callback.raw,
    });
  }

  await recordWebhookLog({
    externalId: verification.externalId || null,
    eventType: callback.type,
    trxId: callback.trxId,
    partnerId: verification.partnerId || null,
    signatureValid: true,
    httpStatus: 200,
    responseCode: ack.responseCode,
    rawHeaders: safeHeaders,
    rawBody,
  });

  return NextResponse.json(ack, { status: 200 });
}
