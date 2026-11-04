"use server";

import { revalidatePath } from "next/cache";
import { verifiedMember } from "../../../../lib/auth/server";
import { createSupabaseServerClient } from "../../../../lib/supabase/server";
import { isLocalPreviewEnabled } from "../../../../lib/runtime";
import {
  PARTNER_EMAIL_PATH,
  parsePartnerEmailEdit,
  partnerEmailEditError,
  type PartnerEmailActionResult,
  type PartnerEmailDetail,
  type PartnerEmailEditCommand,
} from "../../../../lib/partner/email-edit";
import { loadPartnerEmailDetail } from "../../../../lib/partner/email-program-server";
import { PARTNER_ASSISTANT_PATH, PARTNER_PATH } from "../../../../lib/partner/links";
import { isPartnerId } from "../../../../lib/partner/model";

const PREVIEW_MESSAGE = "Anteprima locale: lettura e modifica delle email disattivate.";
const ACCESS_MESSAGE = "Non è stato possibile verificare l'accesso. Accedi di nuovo e riprova.";
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const positiveVersion = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

/** Conferma solo le ricevute complete: un esito incompleto può avere già salvato la modifica. */
function confirmedResult(value: unknown, kind: PartnerEmailEditCommand["kind"]): boolean {
  if (
    !object(value) ||
    !isPartnerId(value.id) ||
    !positiveVersion(value.version) ||
    typeof value.replayed !== "boolean"
  )
    return false;
  switch (kind) {
    case "begin":
      return isPartnerId(value.holdId) && positiveVersion(value.holdVersion);
    case "save":
      return (
        isPartnerId(value.draftId) &&
        typeof value.sha256 === "string" &&
        /^[a-f0-9]{64}$/.test(value.sha256) &&
        value.status === "pronta" &&
        value.holdClosed === true
      );
    case "cancel":
      return (
        value.cancelled === true &&
        (value.resumeState === "pronta" || value.resumeState === "serve_tommaso")
      );
  }
}

export async function readPartnerEmail(
  input: unknown,
): Promise<
  { status: "success"; detail: PartnerEmailDetail } | { status: "rejected"; message: string }
> {
  if (isLocalPreviewEnabled()) return { status: "rejected", message: PREVIEW_MESSAGE };
  try {
    const supabase = await createSupabaseServerClient({ writable: true });
    const access = await verifiedMember(supabase);
    if (access.status !== "member") return { status: "rejected", message: ACCESS_MESSAGE };
    if (
      !object(input) ||
      Object.keys(input).sort().join(",") !== "id,kind" ||
      !(input.kind === "draft" || input.kind === "sent" || input.kind === "job") ||
      !isPartnerId(input.id)
    )
      return { status: "rejected", message: "Seleziona un'email valida e riprova." };
    const detail = await loadPartnerEmailDetail(supabase, input.kind, input.id);
    return { status: "success", detail };
  } catch {
    return { status: "rejected", message: "Email non disponibile. Ricarica e riprova." };
  }
}

export async function mutatePartnerEmail(value: unknown): Promise<PartnerEmailActionResult> {
  if (isLocalPreviewEnabled()) return { status: "rejected", message: PREVIEW_MESSAGE };
  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient({ writable: true });
    const access = await verifiedMember(supabase);
    if (access.status !== "member") return { status: "rejected", message: ACCESS_MESSAGE };
    if (access.member.role !== "founder")
      return { status: "rejected", message: "Questa modifica è riservata a Tommi." };
  } catch {
    return { status: "rejected", message: ACCESS_MESSAGE };
  }
  const command = parsePartnerEmailEdit(value);
  if (command === null)
    return {
      status: "rejected",
      message: "Controlla oggetto e testo: ci sono dati mancanti o non validi.",
    };
  const rpc = {
    begin: "begin_partner_email_edit",
    save: "save_partner_email_edit",
    cancel: "cancel_partner_email_edit",
  } as const;
  try {
    const { data, error } = await supabase
      .rpc(rpc[command.kind], {
        p_operation_id: command.operationId,
        p_payload: command.payload,
      })
      .abortSignal(AbortSignal.timeout(10_000));
    if (error) return partnerEmailEditError(error);
    if (!confirmedResult(data, command.kind)) return partnerEmailEditError(null);
    for (const path of [PARTNER_EMAIL_PATH, PARTNER_PATH, PARTNER_ASSISTANT_PATH])
      revalidatePath(path);
    return {
      status: "success",
      message:
        command.kind === "begin"
          ? "L'email è ferma mentre la modifichi."
          : command.kind === "save"
            ? "Testo salvato. Questa è la versione approvata per l'invio."
            : "Modifica annullata. La bozza precedente è conservata.",
    };
  } catch {
    return partnerEmailEditError(null);
  }
}
