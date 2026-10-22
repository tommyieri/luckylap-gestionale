import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifiedMember } from "../auth/server";
import { readTeamPages } from "../team/read";
import { isTeamId } from "../team/model";
import {
  parsePartnerWorkCommand,
  partnerWorkReceipt,
  partnerWorkSnapshot,
  type PartnerWorkResult,
} from "./model";

/** All reads use the current member's RLS and complete keyset pages. No contact details are selected. */
export async function readPartnerWorkLinks(supabase: SupabaseClient) {
  const access = await verifiedMember(supabase);
  if (access.status !== "member") return access;
  const read = (table: string, columns: string) =>
    readTeamPages((after, limit) => {
      let query = supabase.from(table).select(columns, { count: "exact" }).order("id").limit(limit);
      if (after !== null) query = query.gt("id", after);
      return query;
    });
  const [partners, links, orders, eventSales] = await Promise.all([
    read(
      "partners",
      "id,co,name,sections,event_starts_on,event_ends_on,application_deadline,stage",
    ),
    read(
      "partner_work_links",
      "id,partner_id,kind,task_id,calendar_event_id,project_id,version,needs_review,detached",
    ),
    read("sales_orders", "id,external_reference,occurred_at,channel"),
    readEventSales(supabase),
  ]);
  return {
    status: "ready" as const,
    member: access.member,
    snapshot: partnerWorkSnapshot(partners, links, orders, eventSales),
  };
}

async function readEventSales(supabase: SupabaseClient): Promise<unknown[]> {
  const rows: unknown[] = [];
  let total: number | null = null;
  let cursor: { eventId: string; orderId: string } | null = null;
  do {
    let query = supabase
      .from("partner_event_sales")
      .select("event_id,order_id,partner_id", { count: "exact" })
      .order("event_id")
      .order("order_id")
      .limit(200);
    if (cursor)
      query = query.or(
        `event_id.gt.${cursor.eventId},and(event_id.eq.${cursor.eventId},order_id.gt.${cursor.orderId})`,
      );
    const page = await query;
    if (
      page.error ||
      !Array.isArray(page.data) ||
      !Number.isSafeInteger(page.count) ||
      page.count === null ||
      page.count < 0 ||
      page.count > 10000 ||
      (total !== null && total - rows.length !== page.count)
    )
      throw new Error("La lettura delle vendite collegate non è completa.");
    total ??= page.count;
    if (page.data.length !== Math.min(200, total - rows.length))
      throw new Error("La lettura delle vendite collegate non è completa.");
    for (const row of page.data) {
      if (
        !isTeamId(row.event_id) ||
        !isTeamId(row.order_id) ||
        (cursor !== null &&
          `${row.event_id}:${row.order_id}` <= `${cursor.eventId}:${cursor.orderId}`)
      )
        throw new Error("La lettura delle vendite collegate non è completa.");
      cursor = { eventId: row.event_id, orderId: row.order_id };
    }
    rows.push(...page.data);
  } while (rows.length < total);
  return rows;
}

const messages: Record<string, string> = {
  partner_work_access_required: "Accedi di nuovo prima di collegare il lavoro del team.",
  partner_work_changed:
    "L’appuntamento o il collegamento è cambiato. Rileggi i dati prima di scegliere di nuovo.",
  partner_work_idempotency_conflict:
    "Il riferimento è già associato a un altro invio. Conserva il tentativo e verifica l’elenco prima di scartarlo.",
  partner_work_source_missing:
    "Il Partner o il collegamento non è più disponibile. Rileggi l’elenco.",
  partner_work_date_required: "Inserisci prima le date dell’evento nella scheda Partner.",
  partner_work_event_required: "Collega prima l’appuntamento dell’evento a questa scheda Partner.",
  partner_work_event_has_sales:
    "L’appuntamento conserva vendite collegate. Mantieni le modifiche manuali oppure verifica l’appuntamento nel calendario prima di rimuoverlo.",
  partner_work_production_owner_required:
    "Serve un membro Produzione abilitato prima di creare il progetto.",
  invalid_partner_work_payload: "La richiesta non è valida. Rileggi i dati prima di riprovare.",
  invalid_payload: "La richiesta non è valida. Rileggi i dati prima di riprovare.",
};
const uncertain = (): PartnerWorkResult => ({
  status: "uncertain",
  message: "Esito non confermato. Verifica lo stesso invio prima di continuare.",
});
export async function executePartnerWork(
  supabase: SupabaseClient,
  value: unknown,
): Promise<PartnerWorkResult> {
  const retry = !!value && typeof value === "object" && "retry" in value && value.retry === true;
  let submitted = false;
  try {
    const access = await verifiedMember(supabase);
    if (access.status !== "member")
      return retry
        ? uncertain()
        : {
            status: "rejected",
            code: "partner_work_access_required",
            message: messages.partner_work_access_required,
          };
    const command = parsePartnerWorkCommand(value);
    if (!command)
      return retry
        ? uncertain()
        : {
            status: "rejected",
            code: "invalid_partner_work_payload",
            message: messages.invalid_partner_work_payload,
          };
    if (command.actorId !== access.member.userId)
      return retry
        ? uncertain()
        : {
            status: "rejected",
            code: "partner_work_access_required",
            message: "L’account è cambiato. Ricarica la pagina prima di iniziare l’operazione.",
          };
    submitted = true;
    const { data, error } = await supabase.rpc("create_partner_work", {
      p_operation_id: command.operationId,
      p_payload: command.payload,
    });
    if (error) {
      if (
        retry &&
        [
          "partner_work_access_required",
          "invalid_partner_work_payload",
          "invalid_payload",
        ].includes(error.message)
      )
        return uncertain();
      if (
        ["42501", "40001", "23505", "22023"].includes(error.code) &&
        Object.hasOwn(messages, error.message)
      )
        return { status: "rejected", code: error.message, message: messages[error.message] };
      return uncertain();
    }
    const receipt = partnerWorkReceipt(data, command);
    if (!receipt) return uncertain();
    const message = receipt.replayed
      ? "Operazione già registrata: conferma recuperata."
      : command.payload.kind === "resolve"
        ? "Scelta sull’appuntamento salvata."
        : command.payload.kind === "link_sale"
          ? "Vendita collegata all’evento."
          : command.payload.kind === "event"
            ? "Appuntamento collegato al calendario del team."
            : command.payload.kind === "project"
              ? "Progetto collegato a Produzione."
              : "Attività di apertura conto vendita collegata al team.";
    return { status: "success", receipt, message };
  } catch {
    return submitted || retry
      ? uncertain()
      : {
          status: "rejected",
          code: "unavailable",
          message: "Accesso non verificabile. Nessun nuovo invio eseguito.",
        };
  }
}
