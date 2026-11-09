import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isCalendarDay } from "./dates";
import { parsePartnerSendPlan, type PartnerSendPlan } from "./send-plan";

/** Il chiamante ha già verificato il membro. Errore, RPC mancante e dati superati restano
 * isolati dal resto della pagina e non vengono trasformati in un piano vuoto. */
export async function loadPartnerSendPlan(
  supabase: SupabaseClient,
  day: string,
): Promise<PartnerSendPlan | null> {
  if (!isCalendarDay(day)) return null;
  try {
    const { data, error } = await supabase
      .rpc("read_partner_send_plan", { p_day: day })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) return null;
    const plan = parsePartnerSendPlan(data);
    return plan?.day === day ? plan : null;
  } catch {
    return null;
  }
}
