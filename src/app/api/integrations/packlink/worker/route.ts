import { receivePacklinkWorkerTick } from "@/lib/packlink/worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return receivePacklinkWorkerTick(request);
}
