import "server-only";
import { randomUUID } from "node:crypto";
import { boundedPhase } from "../shopify/worker-io";
import type { PartnerAssistantConfig } from "./config";
import type { PartnerAssistantMailConfig } from "./mail-config";
import { checkPartnerAssistantInboxMailbox } from "./inbox-mailbox";
import {
  createPartnerInboxStore,
  type PartnerInboxOutcome,
  type PartnerInboxStore,
} from "./inbox-store";

export const PARTNER_INBOX_BUDGET_MS = 35_000;
export type PartnerInboxRun = { status: "idle" | "observed" | "uncertain" };
export type PartnerInboxDependencies = {
  store?: PartnerInboxStore;
  checkMailbox?: typeof checkPartnerAssistantInboxMailbox;
  uuid?: () => string;
};

/** La scansione precede SMTP, usa la stessa lease della casella e non autorizza invii.
 * Record e cursore vengono salvati insieme; un errore lascia gli UID da rileggere. */
export async function runPartnerAssistantInbox(
  config: PartnerAssistantConfig,
  mail: PartnerAssistantMailConfig,
  parentSignal: AbortSignal,
  dependencies: PartnerInboxDependencies = {},
): Promise<PartnerInboxRun> {
  const store = dependencies.store ?? createPartnerInboxStore(config);
  const checkMailbox = dependencies.checkMailbox ?? checkPartnerAssistantInboxMailbox;
  let lease: string | null = null;
  let outcome: PartnerInboxOutcome = "inbox_incerta";
  try {
    return await boundedPhase(parentSignal, PARTNER_INBOX_BUDGET_MS - 5_000, async (signal) => {
      const claimed = await store.claim((dependencies.uuid ?? randomUUID)(), 60, signal);
      if (!claimed.ok) return { status: "uncertain" };
      if (claimed.value.status === "idle") return { status: "idle" };
      const claim = claimed.value;
      lease = claim.lease_token;
      const result = await boundedPhase(signal, 25_000, (phase) =>
        checkMailbox(
          mail,
          {
            activated_at: claim.activated_at,
            cursor: claim.cursors[0],
            candidates: claim.candidates,
          },
          phase,
        ),
      );
      if (result.status !== "complete") return { status: "uncertain" };
      const recorded = await store.record(lease, result.batch, signal);
      if (!recorded.ok || recorded.value.status !== "recorded") return { status: "uncertain" };
      outcome = "inbox_osservata";
      return { status: "observed" };
    });
  } catch {
    return { status: "uncertain" };
  } finally {
    if (lease) {
      try {
        const released = await boundedPhase(parentSignal, 5_000, (signal) =>
          store.release(lease!, outcome, signal),
        );
        if (!released.ok || released.value.status !== "done") return { status: "uncertain" };
      } catch {
        return { status: "uncertain" }; /* La scadenza della lease conserva il recupero. */
      }
    }
  }
}
