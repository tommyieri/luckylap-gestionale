import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { partnerAssistantOptOutLine } from "../partner-assistant/opt-out";
import { addDays, isCalendarDay } from "./dates";
import {
  partnerEmailDetailFrom,
  type PartnerEmailDetail,
  type PartnerEmailReadKind,
} from "./email-edit";
import { forecastPartnerEmails, parsePartnerEmailProgram } from "./email-program";
import { isPartnerId } from "./model";

const unavailable = (): never => {
  throw new Error("Programma email non disponibile.");
};

/** Il chiamante verifica il membro immediatamente prima della lettura con il suo client RLS. */
export async function loadPartnerEmailProgram(
  supabase: SupabaseClient,
  from: string,
  days: number,
) {
  if (
    !isCalendarDay(from) ||
    !Number.isSafeInteger(days) ||
    days < 1 ||
    days > 90 ||
    !isCalendarDay(addDays(from, days - 1))
  )
    return unavailable();
  try {
    const { data, error } = await supabase
      .rpc("read_partner_email_program", { p_from: from, p_days: days })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) return unavailable();
    const snapshot = parsePartnerEmailProgram(data);
    if (snapshot.from !== from || snapshot.days !== days) return unavailable();
    return { snapshot, forecast: forecastPartnerEmails(snapshot) };
  } catch {
    return unavailable();
  }
}

const LANGUAGES: readonly string[] = ["it", "en", "de", "fr", "es"];
const REGISTERS: readonly string[] = ["voi", "lei", "you", "sie", "vous", "usted"];

/** Dati completi solo al clic: nessun MIME, allegato o campo estraneo della RPC arriva al client. */
export async function loadPartnerEmailDetail(
  supabase: SupabaseClient,
  kind: PartnerEmailReadKind,
  id: string,
): Promise<PartnerEmailDetail> {
  if (!(kind === "draft" || kind === "sent" || kind === "job") || !isPartnerId(id))
    return unavailable();
  try {
    const { data, error } = await supabase
      .rpc("read_partner_email_detail", { p_kind: kind, p_id: id })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) return unavailable();
    const parsed = partnerEmailDetailFrom(data);
    if (parsed.kind !== kind || parsed.id !== id) return unavailable();
    for (const key of ["status", "step", "reason"] as const)
      if (parsed[key] !== undefined && parsed[key] !== null && typeof parsed[key] !== "string")
        return unavailable();
    const detail: PartnerEmailDetail = {
      kind: parsed.kind,
      id: parsed.id,
      jobId: parsed.jobId,
      draftId: parsed.draftId,
      partnerId: parsed.partnerId,
      co: parsed.co,
      name: parsed.name,
      sections: parsed.sections,
      subject: parsed.subject,
      body: parsed.body,
      signature: parsed.signature,
      language: parsed.language,
      register: parsed.register,
      address: parsed.address,
      lookbookCode: parsed.lookbookCode,
      sha256: parsed.sha256,
      rulesVersion: parsed.rulesVersion,
      createdAt: parsed.createdAt,
      sentAt: parsed.sentAt,
      choiceReason: parsed.choiceReason,
      researchSources: parsed.researchSources,
      hold: parsed.hold
        ? { id: parsed.hold.id, version: parsed.hold.version, createdAt: parsed.hold.createdAt }
        : null,
      editable: parsed.editable,
      whyNotEditable: parsed.whyNotEditable,
      ...(parsed.status === undefined ? {} : { status: parsed.status }),
      ...(parsed.step === undefined ? {} : { step: parsed.step }),
      ...(parsed.reason === undefined ? {} : { reason: parsed.reason }),
    };
    if (kind === "sent" || (kind === "job" && detail.draftId === null)) return detail;
    if (
      detail.language === null ||
      !LANGUAGES.includes(detail.language) ||
      detail.register === null ||
      !REGISTERS.includes(detail.register)
    )
      return unavailable();
    return {
      ...detail,
      optOut: partnerAssistantOptOutLine(),
    };
  } catch {
    return unavailable();
  }
}
