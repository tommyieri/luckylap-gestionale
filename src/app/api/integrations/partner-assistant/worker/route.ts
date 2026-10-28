import { after } from "next/server";
import { receivePartnerAssistantTick } from "@/lib/partner-assistant/worker";

export const runtime = "nodejs";
// Il massimo di Vercel Hobby con Fluid compute: il passo ha un budget proprio di 270 secondi.
export const maxDuration = 300;

export async function POST(request: Request) {
  return receivePartnerAssistantTick(request, after);
}
