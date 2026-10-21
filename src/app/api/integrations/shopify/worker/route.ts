import { receiveShopifyWorkerTick } from "@/lib/shopify/worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return receiveShopifyWorkerTick(request);
}
