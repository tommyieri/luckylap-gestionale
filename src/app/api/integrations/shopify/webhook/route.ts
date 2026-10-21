import { receiveShopifyWebhook } from "@/lib/shopify/receiver";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return receiveShopifyWebhook(request);
}
