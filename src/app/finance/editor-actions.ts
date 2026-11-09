"use server";

import { createSupabaseServerClient } from "../../lib/supabase/server";
import { verifiedMember } from "../../lib/auth/server";
import { isSensitiveAreaEligible } from "../../lib/auth/model";
import { verifiedSensitiveAccess } from "../../lib/auth/sensitive-access";
import {
  financeRevisionTarget,
  revisionUuid,
  type FinanceRevisionHistory,
} from "../../lib/finance-revisions/model";
import { loadFinanceRevisionHistory } from "../../lib/finance-revisions/server";
import { loadShopPaymentFinanceHistory } from "../../lib/finance-revisions/shop-payment-server";
import type { ShopPaymentFinanceHistory } from "../../lib/finance-revisions/shop-payment-model";
import { readFinanceProfileNames } from "../../lib/finance-revisions/names-server";
import { isLocalPreviewEnabled } from "../../lib/runtime";

export type FinanceEditorResult =
  | { kind: "revision"; history: FinanceRevisionHistory; names: Record<string, string> }
  | { kind: "shop_payment"; history: ShopPaymentFinanceHistory; names: Record<string, string> }
  | { kind: "unavailable"; message: string };

/** Every invocation verifies the caller and the Finance password session before data reads. */
export async function loadFinanceEditor(
  actorId: string,
  source: string,
  sourceId: string,
): Promise<FinanceEditorResult> {
  const unavailable = (): FinanceEditorResult => ({
    kind: "unavailable",
    message:
      "Non riesco a leggere il movimento e lo storico completo. Verifica la sessione Finance e riprova.",
  });
  if (isLocalPreviewEnabled())
    return {
      kind: "unavailable",
      message: "Anteprima: le modifiche richiedono il workspace condiviso e la sessione Finance.",
    };
  if (!revisionUuid(actorId) || typeof source !== "string" || !revisionUuid(sourceId))
    return unavailable();
  const target = financeRevisionTarget(source, sourceId);
  if (!target) return unavailable();
  try {
    const db = await createSupabaseServerClient();
    const access = await verifiedMember(db);
    if (
      access.status !== "member" ||
      access.member.userId !== actorId ||
      !isSensitiveAreaEligible(access.member, "finance")
    )
      return unavailable();
    if ((await verifiedSensitiveAccess(db, access.member, "finance")) !== true)
      return unavailable();
    if (target.type === "consignment-payment") {
      const [history, names] = await Promise.all([
        loadShopPaymentFinanceHistory(db, target.paymentId),
        readFinanceProfileNames(db),
      ]);
      return { kind: "shop_payment", history, names };
    }
    const [history, names] = await Promise.all([
      loadFinanceRevisionHistory(db, target.ref),
      readFinanceProfileNames(db),
    ]);
    return { kind: "revision", history, names };
  } catch {
    return unavailable();
  }
}
