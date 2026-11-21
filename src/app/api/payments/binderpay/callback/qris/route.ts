import { handleBinderPayWebhookRequest } from "@/lib/paymentService";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return handleBinderPayWebhookRequest(req, "qris");
}
