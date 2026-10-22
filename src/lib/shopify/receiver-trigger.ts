import "server-only";
import { receiveShopifyWebhook } from "./receiver";
import { runShopifyWorker } from "./worker";
import { shopifyWorkerConfig, type ShopifyWorkerEnvironment } from "./worker-config";

type AfterResponse = (callback: () => Promise<void>) => void;

/** after() is a latency optimization; the durable Cron/lease path is authoritative. */
export async function receiveShopifyWebhookWithTrigger(
  request: Request,
  afterResponse: AfterResponse,
  dependencies: {
    environment?: ShopifyWorkerEnvironment;
    receive?: (request: Request) => Promise<Response>;
    run?: typeof runShopifyWorker;
  } = {},
): Promise<Response> {
  // No acknowledgment and no background trigger can precede durable persistence.
  const response = await (dependencies.receive ?? receiveShopifyWebhook)(request);
  if (response.status !== 200) return response;
  const config = shopifyWorkerConfig(dependencies.environment);
  if (!config) return response;
  try {
    afterResponse(async () => {
      try {
        // A sent HTTP response must not cancel the independent worker cycle.
        // Never retain the raw notification, caller cookies or Request in this task.
        await (dependencies.run ?? runShopifyWorker)(config, new AbortController().signal);
      } catch {
        /* A future scheduled tick recovers the persisted job/lease. */
      }
    });
  } catch {
    /* Registration failure cannot undo the persisted receipt. */
  }
  return response;
}
