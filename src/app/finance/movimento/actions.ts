"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "../../../lib/supabase/server";
import { verifiedMember } from "../../../lib/auth/server";
import { executeFinanceRevision } from "../../../lib/finance-revisions/server";
import type { FinanceRevisionResult } from "../../../lib/finance-revisions/model";
import { isLocalPreviewEnabled } from "../../../lib/runtime";
/** Actor is checked afresh, including retries after a shared-browser account switch. */
export async function reviseMovement(
  actorId: string,
  value: unknown,
): Promise<FinanceRevisionResult> {
  if (isLocalPreviewEnabled())
    return {
      status: "uncertain",
      message:
        "Anteprima locale: nessun invio eseguito. La verifica dei tentativi richiede il workspace condiviso.",
    };
  try {
    const db = await createSupabaseServerClient({ writable: true });
    const access = await verifiedMember(db);
    if (access.status !== "member" || access.member.userId !== actorId)
      return {
        status: "uncertain",
        message:
          "L’account è cambiato o non è verificabile. Rientra con l’account che ha preparato questo invio.",
      };
    const result = await executeFinanceRevision(db, value);
    if (result.status === "success") {
      for (const path of [
        "/finance",
        "/finance/work",
        "/finance/movimento",
        "/sales",
        "/consignment",
        "/audit",
        "/",
      ])
        try {
          revalidatePath(path);
        } catch {
          /* Keep the confirmed receipt. */
        }
      try {
        revalidatePath("/consignment", "layout");
      } catch {
        /* Keep the confirmed receipt. */
      }
      for (const path of ["/consignment/[code]", "/consignment/[code]/resoconto/[month]"]) {
        try {
          revalidatePath(path, "page");
        } catch {
          /* Keep the confirmed receipt. */
        }
      }
    }
    return result;
  } catch {
    return {
      status: "uncertain",
      message: "Esito non confermato. Conserva e verifica lo stesso invio.",
    };
  }
}
