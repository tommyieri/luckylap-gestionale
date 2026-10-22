import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revisionUuid } from "./model";
import { PAYMENT_STATES } from "../consignment/shop-model";
/** Only id/state crosses this membership boundary; monetary values remain Finance-only. */
export async function withCurrentShopPaymentStates(
  db: SupabaseClient,
  reports: unknown[],
): Promise<unknown[]> {
  const ids = reports.map((raw) =>
    raw !== null && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).id
      : null,
  );
  const fail = (): never => {
    throw Error("Stati dei resoconti non disponibili. Ricarica la pagina.");
  };
  if (ids.some((id) => !revisionUuid(id)) || new Set(ids).size !== ids.length) return fail();
  const states = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const group = ids.slice(offset, offset + 200) as string[],
      { data, error } = await db.rpc("read_consignment_payment_states", { p_report_ids: group });
    if (error || !Array.isArray(data) || data.length !== group.length) return fail();
    for (const raw of data) {
      const row =
        raw !== null && typeof raw === "object" && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : null;
      if (
        !row ||
        Object.keys(row).length !== 2 ||
        !revisionUuid(row.report_id) ||
        !group.includes(row.report_id) ||
        !PAYMENT_STATES.includes(row.payment_state as never) ||
        states.has(row.report_id)
      )
        return fail();
      states.set(row.report_id, row.payment_state as string);
    }
  }
  return reports.map((raw) => ({
    ...(raw as Record<string, unknown>),
    payment_state: states.get((raw as Record<string, unknown>).id as string) ?? fail(),
  }));
}
