import { after } from "next/server";
import { receiveShopifyWebhookWithTrigger } from "@/lib/shopify/receiver-trigger";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return receiveShopifyWebhookWithTrigger(request, after);
}
